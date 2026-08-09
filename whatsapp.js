const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const {
  default: makeWASocket,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  initAuthCreds,
  BufferJSON,
  proto,
} = require('@whiskeysockets/baileys')
const pino = require('pino')
const config = require('./config')
const db = require('./db')

const STATUS_JID = 'status@broadcast'
const sessions = new Map()
const ownJidsByNumber = new Map()
let latestVersionPromise = null
let notifyFn = null

const LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 }

function canLog(level) {
  const current = LOG_LEVELS[config.LOG_LEVEL] ?? LOG_LEVELS.warn
  const wanted = LOG_LEVELS[level] ?? LOG_LEVELS.info
  return current >= wanted
}

function logInfo(...args) {
  if (canLog('info')) console.log(...args)
}
function logWarn(...args) {
  if (canLog('warn')) console.warn(...args)
}
function logError(...args) {
  if (canLog('error')) console.error(...args)
}

function setNotifier(fn) {
  notifyFn = fn
}

async function notify(chatId, text) {
  if (!notifyFn || !chatId) return
  try {
    await notifyFn(chatId, text)
  } catch (e) {
    logError('[إشعار]', e.message)
  }
}

const normalizePhone = (number) => String(number || '').replace(/\D/g, '')
const sessionKey = (userId, number) => `${Number(userId)}:${normalizePhone(number)}`
const sessionIdentity = (userId, number) => `${Number(userId)}_${normalizePhone(number)}`
const authSessionIdFor = (userId, number) => `wa_session_${sessionIdentity(userId, number)}`
const legacyAuthSessionIdFor = (number) => `wa_session_${normalizePhone(number)}`
const authFolderFor = (userId, number) => path.join(config.SESSIONS_DIR, sessionIdentity(userId, number))
const legacyAuthFolderFor = (number) => path.join(config.SESSIONS_DIR, normalizePhone(number))
const authCredsFileFor = (userId, number) => path.join(authFolderFor(userId, number), 'creds.json')

function useDatabaseOnlySessionStorage() {
  return config.SESSION_STORAGE_MODE === 'database' && db.isRemoteSessionStorageEnabled()
}

function fixAuthFileName(file) {
  return String(file || '')
    .replace(/\//g, '__')
    .replace(/:/g, '-')
}

async function readLocalAuthData(userId, number, file) {
  const folders = [authFolderFor(userId, number), legacyAuthFolderFor(number)]
  for (const folder of Array.from(new Set(folders))) {
    try {
      const filePath = path.join(folder, fixAuthFileName(file))
      const raw = await fs.promises.readFile(filePath, 'utf8')
      return JSON.parse(raw, BufferJSON.reviver)
    } catch {}
  }
  return null
}

async function writeLocalAuthData(userId, number, file, value) {
  const folder = authFolderFor(userId, number)
  await fs.promises.mkdir(folder, { recursive: true })
  const filePath = path.join(folder, fixAuthFileName(file))
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  await fs.promises.writeFile(tempPath, JSON.stringify(value, BufferJSON.replacer))
  await fs.promises.rename(tempPath, filePath)
}

async function removeLocalAuthData(userId, number, file) {
  try {
    const filePath = path.join(authFolderFor(userId, number), fixAuthFileName(file))
    await fs.promises.rm(filePath, { force: true })
  } catch {}
}

async function clearLocalAuthFolder(userId, number) {
  try {
    await fs.promises.rm(authFolderFor(userId, number), { recursive: true, force: true })
    await fs.promises.rm(legacyAuthFolderFor(number), { recursive: true, force: true })
  } catch {}
}

async function authStateExists(userId, number) {
  if (db.isRemoteSessionStorageEnabled()) {
    const hasRemote = await db.hasWaAuthSession(authSessionIdFor(userId, number))
    const hasLegacyRemote = await db.hasWaAuthSession(legacyAuthSessionIdFor(number))
    if (hasRemote || hasLegacyRemote) return true
  }
  try {
    await fs.promises.access(authCredsFileFor(userId, number), fs.constants.F_OK)
    return true
  } catch {}
  try {
    await fs.promises.access(path.join(legacyAuthFolderFor(number), 'creds.json'), fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function usePersistentAuthState(userId, number) {
  const sessionId = authSessionIdFor(userId, number)
  const legacySessionId = legacyAuthSessionIdFor(number)
  const scope = typeof db.getSessionScope === 'function'
    ? db.getSessionScope(userId, number)
    : `sessions/${Number(userId)}/${normalizePhone(number)}`
  const dbOnly = useDatabaseOnlySessionStorage()

  if (!dbOnly) {
    await fs.promises.mkdir(authFolderFor(userId, number), { recursive: true })
  }

  const readData = async (file) => {
    if (db.isRemoteSessionStorageEnabled()) {
      const remoteValue = await db.getWaAuthFile(sessionId, file)
      if (remoteValue) return remoteValue
      const legacyRemoteValue = await db.getWaAuthFile(legacySessionId, file)
      if (legacyRemoteValue) return legacyRemoteValue
    }
    return readLocalAuthData(userId, number, file)
  }

  const writeData = async (file, value) => {
    if (!dbOnly) {
      await writeLocalAuthData(userId, number, file, value)
    }
    if (db.isRemoteSessionStorageEnabled()) {
      await db.setWaAuthFile(sessionId, file, value)
    }
  }

  const removeData = async (file) => {
    if (!dbOnly) {
      await removeLocalAuthData(userId, number, file)
    }
    if (db.isRemoteSessionStorageEnabled()) {
      await db.removeWaAuthFile(sessionId, file)
    }
  }

  const creds = (await readData('creds.json')) || initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out = {}
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}.json`)
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value)
              }
              out[id] = value
            })
          )
          return out
        },
        set: async (data) => {
          const localTasks = []
          const remoteMutations = []

          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id]
              const file = `${category}-${id}.json`
              if (!dbOnly) {
                localTasks.push(value ? writeLocalAuthData(userId, number, file, value) : removeLocalAuthData(userId, number, file))
              }
              if (db.isRemoteSessionStorageEnabled()) {
                remoteMutations.push({ fileName: file, value: value ?? null, scope })
              }
            }
          }

          if (localTasks.length) {
            await Promise.all(localTasks)
          }
          if (remoteMutations.length) {
            await db.applyWaAuthMutations(sessionId, remoteMutations)
          }
        },
      },
    },
    saveCreds: async () => {
      await writeData('creds.json', creds)
    },
    removeCreds: async () => {
      await removeData('creds.json')
    },
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getLatestVersion() {
  if (!latestVersionPromise) {
    latestVersionPromise = fetchLatestBaileysVersion()
      .then((result) => result?.version)
      .catch((e) => {
        logWarn('[Baileys version]', e.message)
        return undefined
      })
  }
  return latestVersionPromise
}

function getBrowserProfile() {
  try {
    if (Browsers?.windows) return Browsers.windows('Chrome')
    if (Browsers?.ubuntu) return Browsers.ubuntu('Chrome')
  } catch {}
  return ['Windows', 'Chrome', '122.0.0.0']
}

function getReconnectDelay(statusCode) {
  if (statusCode === DisconnectReason.restartRequired) return 800
  if (statusCode === DisconnectReason.connectionClosed) return 1200
  if (statusCode === DisconnectReason.connectionLost) return 1500
  if (statusCode === DisconnectReason.timedOut) return 2000
  return 3000
}

function buildSelfJidCandidates(sock, phoneNumber) {
  const candidates = []
  const pn = String(phoneNumber || '').replace(/\D/g, '')
  if (pn) {
    candidates.push(`${pn}@s.whatsapp.net`)
    candidates.push(jidNormalizedUser(`${pn}@s.whatsapp.net`))
  }
  try {
    if (sock?.user?.id) {
      candidates.push(jidNormalizedUser(sock.user.id))
      candidates.push(sock.user.id)
    }
    if (sock?.authState?.creds?.me?.id) {
      candidates.push(jidNormalizedUser(sock.authState.creds.me.id))
      candidates.push(sock.authState.creds.me.id)
    }
  } catch {}
  return Array.from(new Set(candidates.filter(Boolean)))
}

function toNumber(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  if (value && typeof value.toNumber === 'function') return value.toNumber()
  if (value && typeof value.low === 'number') return value.low
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function getMessageTimestampMs(msg) {
  const raw = msg?.messageTimestamp
  const ts = toNumber(raw)
  if (!ts) return 0
  return ts > 1e12 ? ts : ts * 1000
}

async function runInBatches(items, limit, delayMs, worker) {
  for (let i = 0; i < items.length; i += limit) {
    const slice = items.slice(i, i + limit)
    await Promise.allSettled(slice.map((item) => worker(item)))
    if (delayMs > 0 && i + limit < items.length) {
      await sleep(delayMs)
    }
  }
}

// ===================== أوامر المالك داخل الرقم المربوط =====================

const PHONE_COMMAND_KEYS = Object.keys(db.DEFAULT_PHONE_SETTINGS || {})

function parsePhoneCommandText(rawText) {
  const text = String(rawText || '').trim()
  if (!text) return null
  const noMentions = text.replace(/@\d+/g, '').trim()
  const m = noMentions.match(/^[.\/#!]+(\S+)/)
  if (!m) return null
  const command = m[1].toLowerCase()
  const rest = noMentions.slice(m[0].length).trim()
  return { raw: text, command, rest }
}

function summarizeSettings(settings) {
  if (!settings) return ''
  const pairs = Object.entries(settings)
    .slice(0, 14)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')
  return pairs
}

function chunkForWhatsApp(text, limit = 1200) {
  const out = []
  let buf = ''
  for (const line of String(text || '').split('\n')) {
    if ((buf + '\n' + line).length > limit) {
      out.push(buf.trim())
      buf = line
    } else {
      buf = buf ? buf + '\n' + line : line
    }
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

function ha(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// مهارات التعرف على الإعدادات (synonyms)
const PHONE_SYNONYMS = {
  name: ['name', 'botname', 'اسم', 'اسمالبوت', 'بوت.اسم'],
  ownerNumber: ['owner', 'ownerNumber', 'المالك', 'رقمالمالك', 'مالك.رقم'],
  ownername: ['ownername', 'اسم_المالك', 'اسمالمالك', 'مالك.اسم'],
  description: ['description', 'about', 'bio', 'بايو', 'الوصف'],
  from: ['from', 'الموقع', 'الدولة', 'من'],
  age: ['age', 'العمر'],
  prefix: ['prefix', 'بادئة', 'البادئة', 'symbol'],
  footer2: ['footer', 'footer2', 'فوتر'],
  mode: ['mode', 'الوضع', 'خاص', 'عام'],
  antiBad: ['antibad', 'سيء', 'مكافحة.سيء', 'antiBad'],
  antiLink: ['antilink', 'رابط', 'مكافحة.رابط', 'antiLink'],
  autoRecording: ['autorecording', 'تسجيل', 'autoRecording'],
  autoTyping: ['autotyping', 'كتابة', 'autoTyping'],
  alwaysOnline: ['alwaysonline', 'اونلاين', 'دائماً', 'alwaysOnline'],
  autoStatusRead: ['autostatusread', 'مشاهدة', 'statusread', 'autoStatusRead'],
  autoStatusReact: ['autostatusreact', 'تفاعل', 'statusreact', 'autoStatusReact'],
  statusReactionNotice: ['statusreactionnotice', 'إشعارالتفاعل', 'statusReactionNotice'],
  keepDeletedStatus: ['keepdeletedstatus', 'حفظ.محذوف', 'keepDeletedStatus'],
  ghostMode: ['ghost', 'شبح', 'ghostMode'],
  autoPrivateReact: ['autoprivatereact', 'تفاعل.خاص', 'autoPrivateReact'],
  autoRead: ['autoread', 'قراءة', 'autoRead'],
  autoBlock: ['autoblock', 'حظر', 'autoBlock'],
  autoReact: ['autoreact', 'تفاعل.تلقائي', 'autoReact'],
  autoVoice: ['autovoice', 'صوت', 'autoVoice'],
  antiDelete: ['antidelete', 'مكافحة.حذف', 'antiDelete'],
  sendDeleteTo: ['senddeleteto', 'إرسال.محذوف.إلى', 'sendDeleteTo'],
  antiCall: ['anticall', 'مكافحة.اتصال', 'antiCall'],
  excludeCallNumbers: ['excludecallnumbers', 'مستثنى.اتصال', 'excludeCallNumbers'],
  statusMsgSend: ['statusmsgsend', 'رسالة.حالة', 'statusMsgSend'],
  statusMsgType: ['statusmsgtype', 'نوع.رسالة.حالة', 'statusMsgType'],
  customMsg: ['custommsg', 'رسالة.مخصصة', 'customMsg'],
  menu: ['menu', 'القائمة', 'صورة.القائمة', 'صورة.المنيو'],
  alive: ['alive', 'aliveImg', 'صورة.alive'],
  owner: ['owner', 'ownerImg', 'صورة.المالك'],
  statusCustomReact: ['statuscustomreact', 'إيموجي', 'emoji', 'التفاعل', 'ستوري'],
  antiBug: ['antibug', 'مكافحة.بق', 'antiBug'],
  antiBot: ['antibot', 'مكافحة.بوت', 'antiBot'],
  antiBotAction: ['antibotaction', 'إجراء.بوت', 'antiBotAction'],
  gaGroupJid: ['gagroupjid', 'معرف.جروب', 'gaGroupJid'],
  gaTimezone: ['gatimezone', 'منطقة.زمنية', 'gaTimezone'],
  gaCloseTime: ['gaclosetime', 'وقت.إغلاق', 'gaCloseTime'],
  gaOpenTime: ['gaopentime', 'وقت.فتح', 'gaOpenTime'],
  customAutoReplies: ['customautoreplies', 'ردود.تلقائية', 'customAutoReplies'],
  autoSave: ['autosave', 'حفظ.تلقائي', 'autoSave'],
  language: ['language', 'لغة', 'language'],
  antiViewOnce: ['antiviewonce', 'منع.عرض.مرة', 'antiViewOnce'],
  antiLinkList: ['antilinklist', 'قائمة.روابط', 'antiLinkList'],
  antiBadWords: ['antibadwords', 'كلمات.سيئة', 'antiBadWords'],
  antiMention: ['antimention', 'منع.منشن', 'antiMention'],
  antiEdit: ['antiedit', 'منع.تعديل', 'antiEdit'],
  antiAction: ['antiaction', 'إجراء.حماية', 'antiAction'],
  antiWarnCount: ['antiwarncount', 'عدد.تحذيرات', 'antiWarnCount'],
  autoReactScope: ['autoreactscope', 'نطاق.تفاعل', 'autoReactScope'],
  aiReplyScope: ['aireplyscope', 'نطاق.رد.ذكي', 'aiReplyScope'],
  aliveMsg: ['alivemsg', 'رسالة.alive', 'aliveMsg'],
  voiceFooter: ['voicefooter', 'فوتر.صوتي', 'voiceFooter'],
}

function normalizeKey(rawKey) {
  const cleaned = String(rawKey || '').trim().toLowerCase().replace(/[\s\-_.]+/g, '')
  for (const [canonical, aliases] of Object.entries(PHONE_SYNONYMS)) {
    const aliasList = aliases.map((a) => String(a).toLowerCase().replace(/[\s\-_.]+/g, ''))
    if (aliasList.includes(cleaned)) return canonical
  }
  // تطابق مباشر إن كان اسم الإعداد نفسه
  if (PHONE_COMMAND_KEYS.includes(rawKey)) return rawKey
  return null
}

class WaSession {
  constructor(userId, number, chatId) {
    this.userId = userId
    this.number = number
    this.chatId = chatId
    this.sock = null
    this.ownJid = null
    this.handledStatusIds = new Map()
    this.outboundTextHashes = new Set()
    this.keepAliveTimer = null
    this.state = null
    this.closed = false
    self.pairingRequested = false
    self.pairingAttempts = 0
    self.isNewPairing = false
    self.resumeNotificationPending = false
    self.channelJoined = false
    self.suppressLoggedOutCleanup = false
    self.startPromise = null
    self.reconnectTimer = null
    self.statusQueue = Promise.resolve()
    self.socketGeneration = 0
    self.commandsEnabled = true
  }

  markOutboundText(text) {
    const cleaned = String(text || '').trim().replace(/\s+/g, ' ')
    if (!cleaned) return
    const hash = crypto.createHash('sha1').update(cleaned).digest('hex').slice(0, 24)
    this.outboundTextHashes.add(hash)
    setTimeout(() => this.outboundTextHashes.delete(hash), 60_000)
  }

  isLikelyOutboundText(text) {
    const cleaned = String(text || '').trim().replace(/\s+/g, ' ')
    if (!cleaned) return false
    const hash = crypto.createHash('sha1').update(cleaned).digest('hex').slice(0, 24)
    return this.outboundTextHashes.has(hash)
  }

  async sendSelfDM(text) {
    if (!this.sock) return false
    const candidates = buildSelfJidCandidates(this.sock, this.number)
    this.markOutboundText(text)
    let lastError = null
    for (const jid of candidates) {
      try {
        await this.sock.sendMessage(jid, { text })
        db.incrementMetric('totalSelfMessages', 1)
        return jid
      } catch (e) {
        lastError = e
      }
    }
    if (lastError) throw lastError
    return false
  }

  async sendReplyTo(jid, text) {
    if (!this.sock || !jid) return false
    this.markOutboundText(text)
    for (const chunk of chunkForWhatsApp(text)) {
      try {
        await this.sock.sendMessage(jid, { text: chunk })
      } catch (e) {
        logWarn(`[${this.number}] فشل إرسال الرد إلى ${jid}:`, e?.message || e)
        return false
      }
    }
    return true
  }

  startKeepAlive() {
    this.stopKeepAlive()
    this.keepAliveTimer = setInterval(() => {
      try {
        if (!this.sock || this.closed) return
        if (typeof this.sock.sendPresenceUpdate === 'function') {
          this.sock.sendPresenceUpdate('available').catch(() => {})
        }
      } catch {}
    }, 25_000)
  }

  stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer)
      this.keepAliveTimer = null
    }
  }

  async start(options = {}) {
    if (this.closed) return null
    if (this.startPromise) return this.startPromise
    this.startPromise = this._start(options)
    try {
      return await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  async _start(options = {}) {
    const resumed = options?.resumed === true
    this.closed = false
    this.resumeNotificationPending = resumed

    const { state, saveCreds } = await usePersistentAuthState(this.userId, this.number)
    this.state = state

    const version = await getLatestVersion()

    const sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      browser: getBrowserProfile(),
      logger: pino({ level: 'silent' }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      fireInitQueries: true,
      keepAliveIntervalMs: 20_000,
      defaultQueryTimeoutMs: undefined,
      connectTimeoutMs: 60_000,
      getMessage: async () => undefined,
      emitOwnEvents: false, // لا تُمرّر رسائل الإرسال الخاصة ضمن upsert
    })
    this.sock = sock
    const generation = ++this.socketGeneration

    sock.ev.on('creds.update', async () => {
      try {
        await saveCreds()
      } catch (e) {
        logError(`[${this.number}] saveCreds`, e.message)
      }
    })

    sock.ev.on('connection.update', (u) => {
      this.onConnectionUpdate(u, sock, generation).catch((e) => logError(`[${this.number}] connection.update`, e.message))
    })

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type === 'append' || type === 'notify') {
        // تجنّب تكرار معالجة رسائلنا الخاصة المرسلة للتو
        const filtered = (messages || []).filter((m) => {
          if (!m?.message) return false
          if (m.key?.fromMe) {
            const text = extractTextFromMessage(m)
            if (text && this.isLikelyOutboundText(text)) return false
          }
          return true
        })
        if (!filtered.length) return
        this.onMessages(filtered, `upsert:${type || 'notify'}`).catch((e) =>
          logError(`[${this.number}] messages.upsert`, e.message)
        )
      }
    })

    if (config.PROCESS_HISTORY_STATUSES) {
      sock.ev.on('messaging-history.set', ({ messages, syncType }) => {
        this.onMessages(messages, `history:${syncType || 'unknown'}`).catch((e) =>
          logError(`[${this.number}] messaging-history.set`, e.message)
        )
      })
    }

    return sock
  }

  async deleteSessionData() {
    await clearLocalAuthFolder(this.userId, this.number)
    if (db.isRemoteSessionStorageEnabled()) {
      await db.clearWaAuthSession(authSessionIdFor(this.userId, this.number))
      await db.clearWaAuthSession(legacyAuthSessionIdFor(this.number))
    }
  }

  async joinChannel() {
    if (!this.sock) return false
    const invite = String(config.WHATSAPP_CHANNEL_INVITE || '').trim()
    if (!invite) return false
    try {
      db.incrementMetric('totalChannelJoinAttempts', 1)
      let newsletterJid = null
      if (typeof this.sock.newsletterMetadata === 'function') {
        try {
          const md = await this.sock.newsletterMetadata('invite', invite)
          newsletterJid = md?.id || null
        } catch {}
      }
      if (!newsletterJid) newsletterJid = `${invite}@newsletter`
      if (typeof this.sock.newsletterFollow === 'function') {
        await this.sock.newsletterFollow(newsletterJid)
      }
      db.setJoinedChannel(this.userId, this.number, true)
      this.channelJoined = true
      db.incrementMetric('totalChannelJoinSuccess', 1)
      return newsletterJid
    } catch (e) {
      logWarn(`[${this.number}] فشل الانضمام للقناة:`, e?.message || e)
      return false
    }
  }

  async handleRemoteLogout() {
    db.setStatus(this.userId, this.number, 'logged_out')
    sessions.delete(sessionKey(this.userId, this.number))
    ownJidsByNumber.delete(this.number)
    await this.deleteSessionData()
    db.removeNumber(this.userId, this.number)
    await notify(
      this.chatId,
      `🚪 تم حذف جلسة الرقم <b>${this.number}</b> من واتساب أو تم تسجيل خروجه.\nتم حذف الرقم من قاعدة البيانات فوراً، ويمكنك ربطه من جديد متى شئت.`
    )
  }

  updateOwnJid() {
    try {
      const sock = this.sock
      const me = sock?.authState?.creds?.me?.id || sock?.user?.id
      if (me) {
        const normalized = jidNormalizedUser(me)
        ownJidsByNumber.set(this.number, normalized)
      }
    } catch {}
  }

  async onConnectionUpdate(update, sourceSock, generation) {
    if (sourceSock && (this.sock !== sourceSock || generation !== this.socketGeneration)) return
    const { connection, lastDisconnect } = update || {}
    const statusCode = lastDisconnect?.error?.output?.statusCode
    const registered = !!this.state?.creds?.registered

    if (connection === 'connecting') {
      if (!registered) db.setStatus(this.userId, this.number, 'pairing')
      else db.setStatus(this.userId, this.number, 'connecting')

      if (!registered && !this.pairingRequested) {
        this.pairingRequested = true
        setTimeout(() => {
          this.requestPairingCode().catch((e) => logError(`[${this.number}] pairing`, e.message))
        }, 1000)
      }
      return
    }

    if (connection === 'open') {
      this.pairingAttempts = 0
      this.pairingRequested = false
      this.updateOwnJid()
      this.startKeepAlive()
      db.setStatus(this.userId, this.number, 'connected')
      const emoji = db.getEmoji(this.userId, this.number) || '❤️'
      const resumedSession = this.resumeNotificationPending === true

      const record = db.getNumber(this.userId, this.number)
      if (record) {
        if (record.autoViewStatus === false) record.autoViewStatus = true
        if (record.autoReactStatus === false) record.autoReactStatus = true
        db.setEmoji(this.userId, this.number, emoji)
      }

      try {
        const websiteLine = config.WEBSITE_URL ? `\n🌐 رابط الموقع الرسمي: ${config.WEBSITE_URL}` : ''
        const panelUrl = `${config.WEBSITE_URL || ''}/panel/${this.number}`.replace(/\/+$/, '')
        const panelLine = panelUrl ? `\n🛠 رابط إعدادات الرقم: ${panelUrl}` : ''
        const helpLine = `\n📖 داخل واتساب نفسه، أرسل:  .help`
        const selfText = resumedSession
          ? `♻️ تمت إعادة جلسة رقمك ${this.number} بنجاح.\n\n` +
            `📩 التفاعل على الحالات مستمر بدون توقف.\n` +
            `😀 إيموجي التفاعل الحالي: ${emoji}\n` +
            `🛠 إدارة الرقم متاحة من الموقع أو بأوامر .help داخل واتساب.` +
            websiteLine +
            panelLine +
            helpLine
          : `✅ تم ربط رقمك ${this.number} بنجاح!\n\n` +
            `⚡ التفاعل على الحالات أصبح فورياً خلال أقل من ثانية.\n` +
            `👁 مشاهدة الحالات: مفعلة\n` +
            `😀 التفاعل التلقائي: ${emoji}\n\n` +
            `🛠 يمكنك إدارة الرقم من:\n` +
            `• موقع الإعدادات عبر الرابط أدناه (كل إعدادات الرقم).\n` +
            `• أوامر المالك داخل واتساب نفسه: أرسل .help لعرضها.\n` +
            `📢 تم ضمّ الرقم تلقائياً إلى قناة الواتساب الرسمية.` +
            websiteLine +
            panelLine +
            helpLine

        await this.sendSelfDM(selfText)
      } catch (e) {
        logWarn(`[${this.number}] تعذر إرسال رسالة الترحيب/الاستعادة:`, e?.message || e)
      } finally {
        this.resumeNotificationPending = false
      }

      this.joinChannel().catch(() => {})

      if (this.isNewPairing) {
        db.incrementMetric('totalSuccessfulLinks', 1)
        this.isNewPairing = false
        await notify(
          this.chatId,
          `✅ تم ربط الرقم <b>${this.number}</b> بنجاح!\n\n` +
            `⚡ التفاعل على الحالات فوري بدون تأخير.\n` +
            `😀 إيموجي التفاعل: <b>${emoji}</b>`
        )
      } else if (resumedSession) {
        await notify(
          this.chatId,
          `♻️ تمت استعادة جلسة الرقم <b>${this.number}</b> بنجاح.\n\n` +
            `⚡ التفاعل على الحالات مستمر على نفس الرقم.`
        )
      } else {
        await notify(
          this.chatId,
          `✅ الرقم <b>${this.number}</b> متصل ويعمل بشكل طبيعي\n\n` +
            `👁 مشاهدة الحالات: مفعلة\n😀 إيموجي التفاعل: <b>${emoji}</b>`
        )
      }

      logInfo(`[${this.number}] الجلسة متصلة وتعمل`)
      return
    }

    if (connection === 'close') {
      if (sourceSock && this.sock !== sourceSock) return
      this.sock = null
      this.state = null
      this.stopKeepAlive()

      if (statusCode === DisconnectReason.loggedOut) {
        if (this.suppressLoggedOutCleanup) {
          this.suppressLoggedOutCleanup = false
          return
        }
        await this.handleRemoteLogout()
        return
      }

      if (this.closed) return

      db.setStatus(this.userId, this.number, 'connecting')
      this.pairingRequested = false
      db.incrementMetric('totalReconnects', 1)
      const delay = getReconnectDelay(statusCode)

      if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
      const reconnectGeneration = this.socketGeneration
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        if (!this.closed && this.socketGeneration === reconnectGeneration) {
          this.start().catch((e) => logError(`[${this.number}] reconnect`, e.message))
        }
      }, delay)
    }
  }

  async requestPairingCode(targetNumber) {
    try {
      if (!this.sock || this.closed) return null
      const raw = String(targetNumber || this.number).replace(/\D/g, '')
      if (!raw) return null
      const code = await this.sock.requestPairingCode(raw)
      const str = String(code || '').match(/.{1,4}/g)?.join('-') || String(code || '')
      db.incrementMetric('totalPairingCodesIssued', 1)
      return { code: String(code || ''), formatted: str }
    } catch (e) {
      logWarn(`[${this.number}] فشل طلب كود الاقتران للرقم ${targetNumber}:`, e?.message || e)
      throw e
    }
  }

  isStatusMessage(msg) {
    return !!msg && !msg.key?.fromMe && msg.key?.remoteJid === STATUS_JID
  }

  isFreshStatus(msg, source) {
    const isHistory = String(source || '').startsWith('history:')
    if (isHistory && !config.PROCESS_HISTORY_STATUSES) return false
    const ts = getMessageTimestampMs(msg)
    if (!ts) return true
    const age = Date.now() - ts
    const maxAge = isHistory ? config.HISTORY_STATUS_MAX_AGE_MS : config.MAX_STATUS_AGE_MS
    return age <= maxAge
  }

  extractStatusParticipant(msg) {
    const candidates = [
      msg?.key?.participant,
      msg?.participant,
      msg?.message?.protocolMessage?.key?.participant,
      msg?.message?.extendedTextMessage?.contextInfo?.participant,
      msg?.message?.imageMessage?.contextInfo?.participant,
      msg?.message?.videoMessage?.contextInfo?.participant,
      msg?.message?.audioMessage?.contextInfo?.participant,
      msg?.message?.reactionMessage?.key?.participant,
      msg.key?.remoteJidAlt,
      msg.key?.remoteJid,
    ]
    for (const candidate of candidates) {
      const value = String(candidate || '').trim()
      if (value && value !== STATUS_JID && value.endsWith('@s.whatsapp.net')) return value
    }
    return ''
  }

  buildStatusDedupKey(msg) {
    const id = String(msg?.key?.id || '').trim()
    const participant = this.extractStatusParticipant(msg) || this.keyParticipant(msg?.key) || ''
    return `${participant || 'unknown'}:${id || 'no-id'}`
  }

  keyParticipant(key) {
    const p = key?.participant
    if (p) return String(p)
    return ''
  }

  pruneHandledStatuses() {
    const maxEntries = 6000
    if (this.handledStatusIds.size <= maxEntries) return
    const excess = this.handledStatusIds.size - 4500
    const keys = Array.from(this.handledStatusIds.keys()).slice(0, excess)
    for (const key of keys) this.handledStatusIds.delete(key)
  }

  async markStatusSeen(msg, participant) {
    if (!this.sock || !msg?.key?.id) return false
    const key = {
      ...msg.key,
      remoteJid: STATUS_JID,
      participant: participant || msg.key?.participant,
    }
    try {
      await this.sock.readMessages([key])
      db.incrementMetric('totalStatusViews', 1)
      return true
    } catch (e) {
      logWarn(`[${this.number}] فشل تعليم الحالة كمشاهدة:`, e.message)
      return false
    }
  }

  async reactToStatus(msg, participant, opts = {}) {
    if (!this.sock || !msg?.key) return false

    const record = db.getNumber(this.userId, this.number)
    const settings = record?.settings || {}
    const emojiCell = settings.statusCustomReact || db.getEmoji(this.userId, this.number) || '❤️'
    const emojis = String(emojiCell)
      .split(/[\s,،]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10)
    if (!emojis.length) emojis.push('❤️')

    const statusParticipant = participant || this.extractStatusParticipant(msg)
    if (!statusParticipant || statusParticipant === STATUS_JID) return false

    const reactionKey = {
      ...msg.key,
      remoteJid: STATUS_JID,
      participant: statusParticipant,
      fromMe: false,
    }
    const mainEmoji = opts?.emoji || emojis[0]

    try {
      await this.sock.sendMessage(
        STATUS_JID,
        {
          react: {
            text: mainEmoji,
            key: reactionKey,
          },
        },
        {
          statusJidList: Array.from(new Set([statusParticipant])),
        }
      )
      db.incrementMetric('totalStatusReactions', 1)

      // إيموجيات إضافية (حتى 10)
      for (let i = 1; i < emojis.length; i++) {
        try {
          await this.sock.sendMessage(
            STATUS_JID,
            { react: { text: emojis[i], key: reactionKey } },
            { statusJidList: [statusParticipant] }
          )
          db.incrementMetric('totalStatusReactions', 1)
        } catch {}
      }
      return true
    } catch (e) {
      logWarn(`[${this.number}] فشل التفاعل على الحالة:`, e?.message || e)
      return false
    }
  }

  async processStatusNow(msg, participant) {
    const record = db.getNumber(this.userId, this.number)
    if (!record) return

    // تفاعل فوري بدون انتظار طوابير صناعية
    const tasks = []
    if (record.autoViewStatus !== false) tasks.push(this.markStatusSeen(msg, participant))
    if (record.autoReactStatus !== false) tasks.push(this.reactToStatus(msg, participant))
    if (!tasks.length) return
    await Promise.allSettled(tasks)
  }

  async handleSingleStatus(msg, source = 'unknown') {
    if (!this.isStatusMessage(msg)) return
    if (!this.isFreshStatus(msg, source)) return

    const dedupKey = this.buildStatusDedupKey(msg)
    if (this.handledStatusIds.has(dedupKey)) return
    this.handledStatusIds.set(dedupKey, Date.now())
    this.pruneHandledStatuses()

    const participant = this.extractStatusParticipant(msg)
    // تنفيذ فوري بدون طابور منظم
    this.processStatusNow(msg, participant).catch((e) =>
      logError(`[${this.number}] status handler`, e?.message || e)
    )
  }

  // معالجة أوامر المالك داخل الرقم المربوط
  async handleOwnerTextCommand(msg, senderJid) {
    if (!this.commandsEnabled) return false
    const text = extractTextFromMessage(msg)
    if (!text) return false
    const parsed = parsePhoneCommandText(text)
    if (!parsed) return false

    const record = db.getNumber(this.userId, this.number)
    if (!record) return false
    const prefix = String(record.settings?.prefix || db.DEFAULT_PHONE_SETTINGS?.prefix || '.').trim() || '.'
    // تحقق أن النص يبدأ فعلاً بالبادئة المحددة
    const startsWithPrefix = (() => {
      const trimmed = String(text || '').trim()
      return trimmed.startsWith(prefix) || /^[.\/#!]+/.test(trimmed)
    })()
    if (!startsWithPrefix) return false

    const cmd = parsed.command
    const rest = parsed.rest
    const replyTarget = senderJid || buildSelfJidCandidates(this.sock, this.number)[0] || `${this.number}@s.whatsapp.net`
    const reply = async (txt) => {
      try {
        await this.sendReplyTo(replyTarget, txt)
      } catch (e) {
        logWarn(`[${this.number}] sendReply:`, e?.message || e)
      }
    }

    if (cmd === 'help' || cmd === 'مساعدة' || cmd === 'h') {
      await reply(this.buildOwnerHelp())
      return true
    }

    if (cmd === 'settings' || cmd === 'الاعدادات' || cmd === 'الإعدادات' || cmd === 'اعداداتي') {
      const s = db.getPhoneSettings(this.userId, this.number) || {}
      const lines = [
        `⚙️ إعدادات الرقم ${this.number}:`,
        `prefix: ${s.prefix || '.'}`,
        `mode: ${s.mode || 'private'}`,
        `emoji: ${s.statusCustomReact || '❤️'}`,
        `autoStatusRead: ${s.autoStatusRead || 'on'}`,
        `autoStatusReact: ${s.autoStatusReact || 'on'}`,
        `autoRead: ${s.autoRead || 'off'}`,
        `autoReact: ${s.autoReact || 'off'}`,
        `antiCall: ${s.antiCall || 'off'}`,
        `language: ${s.language || 'arabic'}`,
        ``,
        `استخدم: ${prefix}set <key> <value>`,
      ]
      await reply(lines.join('\n'))
      return true
    }

    if (cmd === 'emoji' || cmd === 'إيموجي' || cmd === 'التفاعل') {
      const emoji = rest.split(/\s+/)[0]
      if (!emoji) {
        await reply(`❌ أرسل الإيموجي بعد الأمر، مثال: ${prefix}emoji ❤️`)
        return true
      }
      try {
        db.setEmoji(this.userId, this.number, emoji)
        await reply(`✅ تم تغيير إيموجي التفاعل إلى ${emoji} على الرقم ${this.number} فقط.\nسيُطبَّق فوراً على الحالات.`)
      } catch {
        await reply(`❌ تعذر حفظ الإيموجي.`)
      }
      return true
    }

    if (cmd === 'mode' || cmd === 'الوضع') {
      const value = rest.trim().toLowerCase()
      if (!['private', 'public', 'عام', 'خاص', 'self', 'group', 'inbox'].includes(value)) {
        await reply(`❌ القيمة غير معروفة. القيم المتاحة: private | public | self | group | inbox`)
        return true
      }
      let normalized = value
      if (normalized === 'عام') normalized = 'public'
      if (normalized === 'خاص') normalized = 'private'
      db.setPhoneSetting(this.userId, this.number, 'mode', normalized)
      await reply(`✅ تم تغيير وضع الرقم ${this.number} إلى: ${normalized}`)
      return true
    }

    if (cmd === 'prefix' || cmd === 'بادئة' || cmd === 'البادئة') {
      const value = rest.trim()
      if (!value) {
        await reply(`❌ أرسل البادئة الجديدة، مثال: ${prefix}prefix !`)
        return true
      }
      db.setPhoneSetting(this.userId, this.number, 'prefix', value.slice(0, 5))
      await reply(`✅ تم تغيير البادئة إلى: ${value}`)
      return true
    }

    if (cmd === 'set' || cmd === 'ضبط' || cmd === 'تغيير') {
      const tokens = rest.split(/\s+/)
      const keyToken = (tokens.shift() || '').trim()
      const value = tokens.join(' ').trim()
      if (!keyToken) {
        await reply(`❌ الاستخدام: ${prefix}set <key> <value>\nمثال: ${prefix}set autoRead on`)
        return true
      }
      const canonical = normalizeKey(keyToken)
      if (!canonical) {
        const sample = Object.keys(db.DEFAULT_PHONE_SETTINGS).slice(0, 12).join(', ')
        await reply(`❌ الاسم غير معروف. أمثلة: ${sample} ...`)
        return true
      }
      db.setPhoneSetting(this.userId, this.number, canonical, value || 'off')
      await reply(`✅ تم تحديث ${canonical} = ${value || 'off'} على الرقم ${this.number}.`)
      return true
    }

    if (cmd === 'pair' || cmd === 'ربط' || cmd === 'اقتران' || cmd === 'link') {
      // أمر ربط رقم جديد عبر هذا الرقم المربوط
      const target = String(rest || '').replace(/\D/g, '')
      if (!/^\d{8,15}$/.test(target)) {
        await reply(`❌ الاستخدام: ${prefix}pair 9677XXXXXXXX\nأرسل الرقم بالصيغة الدولية بدون +`)
        return true
      }
      try {
        const { code, formatted } = await this.requestPairingCode(target)
        db.incrementMetric('totalSuccessfulLinks', 1) // رغبة في عدّ النية
        await reply(
          `🔗 كود الاقتران للرقم ${target}:\n\n${formatted}\n\n` +
            `📲 خطوات الربط:\n` +
            `1️⃣ افتح واتساب على الرقم (${target})\n` +
            `2️⃣ الإعدادات ← الأجهزة المرتبطة ← ربط جهاز\n` +
            `3️⃣ اختر «الاقتران برقم بدلاً من رمز QR»\n` +
            `4️⃣ أدخل الكود أعلاه الآن`
        )
      } catch (e) {
        await reply(`❌ تعذر إصدار كود الاقتران: ${e?.message || e}`)
      }
      return true
    }

    if (cmd === 'panel' || cmd === 'لوحة' || cmd === 'الإعدادات-موقع') {
      const url = `${config.WEBSITE_URL || ''}/panel/${this.number}`.replace(/\/+$/, '')
      if (!url) {
        await reply(`❌ لم يتم ضبط WEBSITE_URL في السيرفر.`)
        return true
      }
      await reply(
        `🛠 لوحة إعدادات الرقم ${this.number}:\n${url}\n\n` +
          `🔑 كلمة المرور الافتراضية: الرقم نفسه (${this.number})\n` +
          `يمكنك تغييرها بأمر: ${prefix}password <new>`
      )
      return true
    }

    if (cmd === 'password' || cmd === 'باسورد' || cmd === 'كلمة-السر') {
      const newPass = String(rest || '').trim()
      if (newPass.length < 4) {
        await reply(`❌ كلمة المرور يجب ألا تقل عن 4 أحرف.`)
        return true
      }
      try {
        db.setPanelPassword(this.userId, this.number, newPass)
        await reply(`✅ تم تحديث كلمة مرور لوحة إعدادات الرقم ${this.number}.`)
      } catch (e) {
        await reply(`❌ تعذر حفظ كلمة المرور.`)
      }
      return true
    }

    if (cmd === 'autoreact' || cmd === 'تفاعل') {
      const val = String(rest || '').trim().toLowerCase()
      if (!['on', 'off', 'تشغيل', 'إيقاف'].includes(val)) {
        await reply(`❌ القيم المتاحة: on | off`)
        return true
      }
      const norm = (val === 'تشغيل') ? 'on' : (val === 'إيقاف') ? 'off' : val
      db.setPhoneSetting(this.userId, this.number, 'autoStatusReact', norm)
      const record2 = db.getNumber(this.userId, this.number)
      if (record2) {
        record2.autoReactStatus = norm === 'on'
        db.save?.()
      }
      await reply(`✅ التفاعل التلقائي على الحالات الآن: ${norm}`)
      return true
    }

    return false
  }

  buildOwnerHelp() {
    const prefix = db.getPhoneSettings(this.userId, this.number)?.prefix || '.'
    return [
      `📖 أوامر المالك داخل الرقم ${this.number}:`,
      `${prefix}help    - عرض هذه المساعدة`,
      `${prefix}settings - عرض الإعدادات الحالية`,
      `${prefix}emoji ❤️ - تغيير إيموجي التفاعل (يطبَّق فوراً)`,
      `${prefix}mode public|private - وضع البوت داخل الرقم`,
      `${prefix}prefix ! - تغيير البادئة`,
      `${prefix}set <key> <value> - تحديث أي إعداد`,
      `${prefix}autoreact on|off - تشغيل/إيقاف التفاعل الفوري`,
      `${prefix}pair 9677XXX - إصدار كود اقتران لرقم جديد عبر هذا الرقم`,
      `${prefix}password <new> - تحديث كلمة مرور لوحة الإعدادات`,
      `${prefix}panel - رابط موقع إعدادات هذا الرقم`,
      ``,
      `🔑 جميع الأوامر مخصصة لمالك الرقم (الشخص الذي ربط هذا الرقم نفسه).`,
      `🛠 كما يمكنك إدارة الرقم من:`,
      `${config.WEBSITE_URL || ''}/panel/${this.number}`.replace(/\/+$/, ''),
    ].join('\n')
  }

  async onMessages(messages, source = 'unknown') {
    for (const msg of messages || []) {
      const remoteJid = msg.key?.remoteJid
      const isStatus = remoteJid === STATUS_JID
      if (isStatus) {
        await this.handleSingleStatus(msg, source)
        continue
      }

      // أوامر المالك: فقط رسائل fromMe = التي أرسلها صاحب الرقم (المالك)
      if (msg.key?.fromMe) {
        try {
          const sender = remoteJid && remoteJid !== STATUS_JID ? String(remoteJid) : msg.key?.participant || null
          await this.handleOwnerTextCommand(msg, sender)
        } catch (e) {
          logError(`[${this.number}] owner cmd`, e?.message || e)
        }
      }
    }
  }
}

function extractTextFromMessage(msg) {
  const m = msg?.message
  if (!m) return ''
  const candidates = [
    m?.conversation,
    m?.extendedTextMessage?.text,
    m?.imageMessage?.caption,
    m?.videoMessage?.caption,
    m?.documentMessage?.caption,
    m?.buttonsResponseMessage?.selectedDisplayText,
    m?.listResponseMessage?.title,
    m?.reactionMessage?.text,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c
  }
  return ''
}

async function startSession(userId, number, chatId, options = {}) {
  const key = sessionKey(userId, number)
  let ses = sessions.get(key)
  if (!ses) {
    ses = new WaSession(userId, number, chatId)
    sessions.set(key, ses)
  }
  ses.chatId = chatId
  if (!ses.sock) await ses.start(options)
  return ses
}

function getSession(userId, number) {
  return sessions.get(sessionKey(userId, number)) || null
}

function getOwnJidFor(number) {
  return ownJidsByNumber.get(normalizePhone(number)) || null
}

async function stopSession(userId, number, logout = true) {
  const key = sessionKey(userId, number)
  const ses = sessions.get(key)
  const target = ses || new WaSession(userId, number, null)
  target.closed = true
  target.suppressLoggedOutCleanup = logout === true
  sessions.delete(key)
  ownJidsByNumber.delete(normalizePhone(number))
  const sock = ses?.sock || null
  try {
    if (sock) {
      if (logout) await sock.logout()
      if (typeof sock.end === 'function') sock.end(undefined)
    }
  } catch (e) {
    logError('[إيقاف]', e.message)
  }
  if (logout) {
    await target.deleteSessionData()
  }
  return true
}

async function shutdownAll() {
  const active = Array.from(sessions.values())
  for (const ses of active) {
    ses.closed = true
    ses.stopKeepAlive()
    const sock = ses.sock
    ses.sock = null
    try {
      if (sock && typeof sock.end === 'function') sock.end(undefined)
    } catch (e) {
      logError(`[إغلاق ${ses.number}]`, e.message)
    }
  }
}

async function resumeAll() {
  const all = db.getAllNumbers()
  const restorable = []

  for (const item of all) {
    const hasAuth = await authStateExists(item.userId, item.number)
    if (!hasAuth) {
      db.removeNumber(item.userId, item.number)
      logWarn(`[استعادة] لا توجد بيانات جلسة محفوظة للرقم ${item.number} — تم حذف الرقم من القاعدة`)
      continue
    }
    restorable.push(item)
  }

  if (!restorable.length) return

  logInfo(`♻️ بدء استعادة ${restorable.length} جلسة واتساب محفوظة...`)

  await runInBatches(
    restorable,
    config.RESUME_CONCURRENCY,
    config.RESUME_BATCH_DELAY_MS,
    async (item) => {
      await startSession(item.userId, item.number, item.chatId, { resumed: true }).catch((e) =>
        logError(`[استعادة ${item.number}]`, e.message)
      )
    }
  )
}

async function broadcastToWhatsapp(text) {
  const all = db.getAllNumbers()
  const results = { total: all.length, sent: 0, failed: 0, skipped: 0, details: [] }

  for (const item of all) {
    if (item.status !== 'connected') {
      results.skipped++
      results.details.push({ number: item.number, status: 'skipped', reason: 'غير متصل' })
      continue
    }
    const ses = getSession(item.userId, item.number)
    if (!ses || !ses.sock) {
      results.skipped++
      results.details.push({ number: item.number, status: 'skipped', reason: 'لا توجد جلسة نشطة' })
      continue
    }
    try {
      const pn = String(item.number).replace(/\D/g, '')
      const jid = `${pn}@s.whatsapp.net`
      ses.markOutboundText(text)
      await ses.sock.sendMessage(jid, { text })
      results.sent++
      results.details.push({ number: item.number, status: 'sent' })
    } catch (e) {
      results.failed++
      results.details.push({ number: item.number, status: 'failed', reason: e?.message || String(e) })
    }
    await sleep(300)
  }
  return results
}

function getActiveSessionsCount() {
  return sessions.size
}

module.exports = {
  startSession,
  stopSession,
  getSession,
  getActiveSessionsCount,
  setNotifier,
  resumeAll,
  shutdownAll,
  broadcastToWhatsapp,
  STATUS_JID,
  getOwnJidFor,
}
