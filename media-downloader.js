const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const YTDlpWrap = require('yt-dlp-wrap').default
const config = require('./config')

const BIN_DIR = path.join(__dirname, 'bin')
const DEFAULT_BINARY_PATH = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')
const SUPPORTED_PATTERNS = {
  tiktok: [
    /https?:\/\/(?:www\.)?tiktok\.com\/[\w\-./?=&%]+/gi,
    /https?:\/\/vm\.tiktok\.com\/[\w\-./?=&%]+/gi,
    /https?:\/\/vt\.tiktok\.com\/[\w\-./?=&%]+/gi,
  ],
  instagram: [
    /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p|tv)\/[\w\-]+[\w\-./?=&%]*/gi,
  ],
}

let binaryReadyPromise = null
let clientPromise = null

function cleanupUrl(url) {
  return String(url || '').trim().replace(/[)>\]}'",]+$/g, '')
}

function detectPlatform(url) {
  const value = cleanupUrl(url).toLowerCase()
  if (/https?:\/\/(?:www\.)?(?:tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com)\//.test(value)) return 'tiktok'
  if (/https?:\/\/(?:www\.)?instagram\.com\/(?:reel|p|tv)\//.test(value)) return 'instagram'
  return null
}

function extractSupportedSocialUrls(text) {
  const source = String(text || '')
  const matches = []
  for (const patternList of Object.values(SUPPORTED_PATTERNS)) {
    for (const pattern of patternList) {
      const found = source.match(pattern) || []
      for (const item of found) matches.push(cleanupUrl(item))
    }
  }
  return Array.from(new Set(matches.filter((item) => detectPlatform(item))))
}

function extractFirstSupportedUrl(text, platformHint = null) {
  const urls = extractSupportedSocialUrls(text)
  if (!platformHint) return urls[0] || null
  return urls.find((item) => detectPlatform(item) === platformHint) || null
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

function canExecuteBinary(binaryPath) {
  try {
    const result = spawnSync(binaryPath, ['--version'], { stdio: 'pipe', encoding: 'utf8', timeout: 15000 })
    return result.status === 0
  } catch {
    return false
  }
}

async function ensureBinaryPath() {
  if (binaryReadyPromise) return binaryReadyPromise
  binaryReadyPromise = (async () => {
    const envBinary = String(config.YT_DLP_BINARY_PATH || '').trim()
    if (envBinary && canExecuteBinary(envBinary)) return envBinary
    if (canExecuteBinary(DEFAULT_BINARY_PATH)) return DEFAULT_BINARY_PATH
    if (canExecuteBinary('yt-dlp')) return 'yt-dlp'

    ensureDirectory(BIN_DIR)
    await YTDlpWrap.downloadFromGithub(DEFAULT_BINARY_PATH)
    try {
      fs.chmodSync(DEFAULT_BINARY_PATH, 0o755)
    } catch {}
    if (!canExecuteBinary(DEFAULT_BINARY_PATH)) {
      throw new Error('تعذر تجهيز yt-dlp على الخادم')
    }
    return DEFAULT_BINARY_PATH
  })().catch((error) => {
    binaryReadyPromise = null
    throw error
  })
  return binaryReadyPromise
}

async function getClient() {
  if (clientPromise) return clientPromise
  clientPromise = ensureBinaryPath()
    .then((binaryPath) => new YTDlpWrap(binaryPath))
    .catch((error) => {
      clientPromise = null
      throw error
    })
  return clientPromise
}

function buildOutputTemplate(platform) {
  const token = `${platform}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  return path.join(config.MEDIA_DOWNLOAD_DIR, `${token}.%(ext)s`)
}

function pickFinalFileFromStdout(stdout) {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines[lines.length - 1] || ''
}

function buildDownloadArgs(url, outputTemplate) {
  return [
    url,
    '--no-playlist',
    '--no-warnings',
    '--restrict-filenames',
    '--socket-timeout',
    String(Math.max(15, Math.ceil(config.MEDIA_DOWNLOAD_TIMEOUT_MS / 1000))),
    '--retries',
    '3',
    '--fragment-retries',
    '3',
    '--extractor-retries',
    '3',
    '--concurrent-fragments',
    '1',
    '--max-filesize',
    `${config.MEDIA_MAX_SIZE_MB}M`,
    '--format',
    'b[ext=mp4][vcodec!=none][acodec!=none][height<=1080]/b[ext=mp4][vcodec!=none][height<=720]/b[vcodec!=none][acodec!=none][height<=1080]/b',
    '--output',
    outputTemplate,
    '--print',
    'after_move:filepath',
  ]
}

async function downloadSocialVideo(url, options = {}) {
  const cleanUrl = cleanupUrl(url)
  const platform = options.platformHint || detectPlatform(cleanUrl)
  if (!platform) {
    const error = new Error('unsupported_platform')
    error.code = 'unsupported_platform'
    throw error
  }

  ensureDirectory(config.MEDIA_DOWNLOAD_DIR)
  const client = await getClient()
  const metadata = await client.getVideoInfo(cleanUrl).catch(() => null)
  const stdout = await client.execPromise(buildDownloadArgs(cleanUrl, buildOutputTemplate(platform)))
  const filePath = pickFinalFileFromStdout(stdout)

  if (!filePath || !fs.existsSync(filePath)) {
    const error = new Error('download_failed')
    error.code = 'download_failed'
    throw error
  }

  const stats = fs.statSync(filePath)
  const sizeMb = stats.size / (1024 * 1024)
  if (sizeMb > config.MEDIA_MAX_SIZE_MB) {
    cleanupDownloadedFile(filePath)
    const error = new Error('file_too_large')
    error.code = 'file_too_large'
    error.sizeMb = sizeMb
    throw error
  }

  return {
    platform,
    filePath,
    fileSizeBytes: stats.size,
    metadata: metadata && typeof metadata === 'object' ? metadata : null,
  }
}

function cleanupDownloadedFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch {}
}

module.exports = {
  detectPlatform,
  extractSupportedSocialUrls,
  extractFirstSupportedUrl,
  downloadSocialVideo,
  cleanupDownloadedFile,
}
