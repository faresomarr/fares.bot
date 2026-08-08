require('dotenv').config()

function normalizeBaseUrl(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  return value.replace(/\/+$/, '')
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

function parseNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const port = parseNumber(process.env.PORT, 3000)
const mongodbUri = String(process.env.MONGODB_URI || '').trim()
const hasMongoUri = mongodbUri.length > 0
const websiteUrl =
  normalizeBaseUrl(process.env.WEBSITE_URL) ||
  normalizeBaseUrl(process.env.RENDER_EXTERNAL_URL) ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${String(process.env.RAILWAY_PUBLIC_DOMAIN).trim()}` : '') ||
  `http://localhost:${port}`

const sessionStorageMode = String(
  process.env.SESSION_STORAGE_MODE || (hasMongoUri ? 'database' : 'local')
)
  .trim()
  .toLowerCase()

module.exports = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || '',
  ADMIN_IDS: (process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),
  ONLY_ADMINS: parseBoolean(process.env.ONLY_ADMINS, false),

  MONGODB_URI: mongodbUri,
  MONGODB_DB_NAME: String(process.env.MONGODB_DB_NAME || 'fares_bot').trim() || 'fares_bot',
  MONGO_POOL_SIZE: Math.max(20, parseNumber(process.env.MONGO_POOL_SIZE, 80)),

  DB_FILE: process.env.DB_FILE || './data/db.json',
  SESSIONS_DIR: process.env.SESSIONS_DIR || './sessions',
  SESSION_STORAGE_MODE: sessionStorageMode,
  WRITE_LOCAL_STATE_CACHE: parseBoolean(process.env.WRITE_LOCAL_STATE_CACHE, false),
  DB_WRITE_DEBOUNCE_MS: Math.max(100, parseNumber(process.env.DB_WRITE_DEBOUNCE_MS, 800)),

  REACT_DELAY_MIN: parseNumber(process.env.REACT_DELAY_MIN, 0),
  REACT_DELAY_MAX: parseNumber(process.env.REACT_DELAY_MAX, 0),
  MAX_STATUS_AGE_MS: Math.max(1000, parseNumber(process.env.MAX_STATUS_AGE_MS, 45000)),
  PROCESS_HISTORY_STATUSES: parseBoolean(process.env.PROCESS_HISTORY_STATUSES, false),
  HISTORY_STATUS_MAX_AGE_MS: Math.max(1000, parseNumber(process.env.HISTORY_STATUS_MAX_AGE_MS, 15000)),

  RESUME_CONCURRENCY: Math.max(1, parseNumber(process.env.RESUME_CONCURRENCY, 12)),
  RESUME_BATCH_DELAY_MS: Math.max(0, parseNumber(process.env.RESUME_BATCH_DELAY_MS, 250)),

  LOG_LEVEL: String(process.env.LOG_LEVEL || 'warn').trim().toLowerCase() || 'warn',

  PORT: port,
  WEBSITE_URL: websiteUrl,
  SITE_TITLE: process.env.SITE_TITLE || 'Fares Bot',
  SITE_DESCRIPTION:
    process.env.SITE_DESCRIPTION ||
    'منصة رسمية لعرض مميزات البوت، الإحصائيات المباشرة، واستقبال تعليقات واستفسارات المستخدمين مع رد المطور.',
  SITE_ADMIN_TOKEN: process.env.SITE_ADMIN_TOKEN || 'change-this-admin-token',
  MAX_PUBLIC_COMMENTS: parseNumber(process.env.MAX_PUBLIC_COMMENTS, 50),

  DEVELOPER_ID: parseNumber(process.env.DEVELOPER_ID, 7231690686),
  DEVELOPER_WHATSAPP: String(process.env.DEVELOPER_WHATSAPP || '967773987296').replace(/\D/g, ''),
  DEVELOPER_WHATSAPP_URL:
    process.env.DEVELOPER_WHATSAPP_URL ||
    `https://wa.me/${String(process.env.DEVELOPER_WHATSAPP || '967773987296').replace(/\D/g, '')}`,

  WHATSAPP_CHANNEL_URL:
    process.env.WHATSAPP_CHANNEL_URL || 'https://whatsapp.com/channel/0029Vb8jjfWCRs1sVz0x1w3v',
  WHATSAPP_CHANNEL_INVITE: process.env.WHATSAPP_CHANNEL_INVITE || '0029Vb8jjfWCRs1sVz0x1w3v',

  TELEGRAM_BOT_URL: process.env.TELEGRAM_BOT_URL || 'https://t.me/Faresw_bob',
}
