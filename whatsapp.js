const path = require('path')
const fs = require('fs')
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
let latestVersionPromise = null
let notifyFn = null

function setNotifier(fn) {
  notifyFn = fn
}

async function notify(chatId, text) {
  if (!notifyFn || !chatId) return
  try {
    await notifyFn(chatId, text)
  } catch (e) {
    console.error('[إشعار]', e.message)
  }
}

const normalizePhone = (number) => String(number || '').replace(/\D/g, '')
const sessionKey = (userId, number) => `${Number(userId)}:${normalizePhone(number)}`
// A session is owned by both the Telegram user and the WhatsApp number.
// Never use a process-wide socket or a number-only auth directory.
const sessionIdentity = (userId, number) => `${Number(userId)}_${normalizePhone(number)}`
const authSessionIdFor = (userId, number) => `wa_session_${sessionIdentity(userId, number)}`
const legacyAuthSessionIdFor = (number) => `wa_session_${normalizePhone(number)}`
const authFolderFor = (userId, number) => path.join(config.SESSIONS_DIR, sessionIdentity(userId, number))
const legacyAuthFolderFor = (number) => path.join(config.SESSIONS_DIR, normalizePhone(number))
const authCredsFileFor = (userId, number) => path.join(authFolderFor(userId, number), 'creds.json')

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
    // Remove the pre-isolation directory too, if it is no longer used.
    await fs.promises.rm(legacyAuthFolderFor(number), { recursive: true, force: true })
  } catch {}
}

async function authStateExists(userId, number) {
  if (db.isMongoEnabled()) {
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
  await fs.promises.mkdir(authFolderFor(userId, number), { recursive: true })

  const readData = async (file) => {
    if (db.isMongoEnabled()) {
      const remoteValue = await db.getWaAuthFile(sessionId, file)
      if (remoteValue) return remoteValue
      // One-time compatibility fallback for auth created before per-user isolation.
      const legacyRemoteValue = await db.getWaAuthFile(legacyAuthSessionIdFor(number), file)
      if (legacyRemoteValue) return legacyRemoteValue
    }
    return readLocalAuthData(userId, number, file)
  }

  const writeData = async (file, value) => {
    await writeLocalAuthData(userId, number, file, value)
    if (db.isMongoEnabled()) {
      await db.setWaAuthFile(sessionId, file, value)
    }
  }

  const removeData = async (file) => {
    await removeLocalAuthData(userId, number, file)
    if (db.isMongoEnabled()) {
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
          const tasks = []
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id]
              const file = `${category}-${id}.json`
              tasks.push(value ? writeData(file, value) : removeData(file))
            }
          }
          await Promise.all(tasks)
        },
      },
    },
    saveCreds: async () => {
      await writeData('creds.json', creds)
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
        console.error('[Baileys version]', e.message)
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
  if (statusCode === DisconnectReason.restartRequired) return 1000
  if (statusCode === DisconnectReason.connectionClosed) return 2000
  if (statusCode === DisconnectReason.connectionLost) return 3000
  if (statusCode === DisconnectReason.timedOut) return 3500
  return 5000
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

class WaSession {
  constructor(userId, number, chatId) {
    this.userId = userId
    this.number = number
    this.chatId = chatId
    this.sock = null
    this.state = null
    this.closed = false
    this.pairingRequested = false
    this.pairingAttempts = 0
    this.isNewPairing = false
    this.resumeNotificationPending = false
    this.handledStatusIds = new Map()
    this.channelJoined = false
    this.suppressLoggedOutCleanup = false
    this.startPromise = null
    this.reconnectTimer = null
    this.statusQueue = Promise.resolve()
    this.socketGeneration = 0
  }

  async start(options = {}) {
    if (this.closed) return null
    if (this.startPromise) return this.startPromise
    this.startPromise = this._start(options)
    try { return await this.startPromise }
    finally { this.startPromise = null }
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
      keepAliveIntervalMs: 30000,
      defaultQueryTimeoutMs: undefined,
      connectTimeoutMs: 60000,
      getMessage: async () => undefined,
    })
    this.sock = sock
    const generation = ++this.socketGeneration

    sock.ev.on('creds.update', async () => {
      try {
        await saveCreds()
      } catch (e) {
        console.error(`[${this.number}] saveCreds`, e.message)
      }
    })

    sock.ev.on('connection.update', (u) => {
      this.onConnectionUpdate(u, sock, generation).catch((e) => console.error(`[${this.number}] connection.update`, e.message))
    })

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      this.onMessages(messages, `upsert:${type || 'notify'}`).catch((e) =>
        console.error(`[${this.number}] messages.upsert`, e.message)
      )
    })

    sock.ev.on('messaging-history.set', ({ messages, syncType }) => {
      this.onMessages(messages, `history:${syncType || 'unknown'}`).catch((e) =>
        console.error(`[${this.number}] messaging-history.set`, e.message)
      )
    })

    return sock
  }

  async deleteSessionData() {
    await clearLocalAuthFolder(this.userId, this.number)
    if (db.isMongoEnabled()) {
      await db.clearWaAuthSession(authSessionIdFor(this.userId, this.number))
      await db.clearWaAuthSession(legacyAuthSessionIdFor(this.number))
    }
  }

  async sendSelfDM(text) {
    if (!this.sock) return false
    const candidates = buildSelfJidCandidates(this.sock, this.number)
    let lastError = null
    for (const jid of candidates) {
      try {
        await this.sock.sendMessage(jid, { text })
        db.incrementMetric('totalSelfMessages', 1)
        return jid
      } catch (e) {
        lastError = e
        console.error(`[${this.number}] فشل إرسال DM إلى ${jid}:`, e?.message || e)
      }
    }
    if (lastError) throw lastError
    return false
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
        } catch (e) {
          console.error(`[${this.number}] newsletterMetadata(invite) فشل:`, e?.message || e)
        }
      }
      if (!newsletterJid) newsletterJid = `${invite}@newsletter`
      if (typeof this.sock.newsletterFollow === 'function') {
        await this.sock.newsletterFollow(newsletterJid)
      }
      db.setJoinedChannel(this.userId, this.number, true)
      this.channelJoined = true
      db.incrementMetric('totalChannelJoinSuccess', 1)
      console.log(`[${this.number}] ✅ انضم إلى القناة ${newsletterJid}`)
      return newsletterJid
    } catch (e) {
      console.error(`[${this.number}] ❌ فشل الانضمام للقناة:`, e?.message || e)
      return false
    }
  }

  async handleRemoteLogout() {
    db.setStatus(this.userId, this.number, 'logged_out')
    sessions.delete(sessionKey(this.userId, this.number))
    await this.deleteSessionData()
    db.removeNumber(this.userId, this.number)
    await notify(
      this.chatId,
      `🚪 تم حذف جلسة الرقم <b>${this.number}</b> من واتساب أو تم تسجيل خروجه.\nتم حذف الرقم من قاعدة البيانات فوراً، ويمكنك ربطه من جديد متى شئت.`
    )
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
          this.requestPairingCode().catch((e) => console.error(`[${this.number}] pairing`, e.message))
        }, 1500)
      }
      return
    }

    if (connection === 'open') {
      this.pairingAttempts = 0
      this.pairingRequested = false
      db.setStatus(this.userId, this.number, 'connected')
      const emoji = db.getEmoji(this.userId, this.number) || '❤️'
      const resumedSession = this.resumeNotificationPending === true

      const record = db.getNumber(this.userId, this.number)
      if (record) {
        if (record.autoViewStatus === false) record.autoViewStatus = true
        if (record.autoReactStatus === false) record.autoReactStatus = true
        db.setEmoji(this.userId, this.number, emoji)
      }

      const t0 = Date.now()
      try {
        const websiteLine = config.WEBSITE_URL ? `\n🌐 رابط الموقع الرسمي: ${config.WEBSITE_URL}` : ''
        const selfText = resumedSession
          ? `♻️ تمت إعادة جلسة رقمك ${this.number} بنجاح بعد إعادة تشغيل البوت.\n\n` +
            `✅ رجعت الجلسة للعمل تلقائياً بدون إعادة ربط.\n` +
            `👁 مشاهدة الحالات: مفعلة\n` +
            `😀 التفاعل التلقائي على الحالات: ${emoji}\n\n` +
            `البوت رجع للعمل على هذا الرقم بشكل طبيعي الآن.` +
            websiteLine
          : `✅ تم ربط رقمك ${this.number} بنجاح!\n\n` +
            `👁 تم تفعيل مشاهدة الحالات تلقائياً\n` +
            `😀 تم تفعيل التفاعل التلقائي على الحالات بالإيموجي ${emoji} لهذا الرقم.\n\n` +
            `كل حالة جديدة ستصلك عليها علامة قراءة + قلب ${emoji} تلقائياً خلال ثانية واحدة.\n\n` +
            `📢 تم ضمّ الرقم تلقائياً إلى قناة الواتساب الرسمية.\n` +
            `💬 لأي استفسار كلّم المطور من داخل البوت عبر زر «مراسلة المطور».` +
            websiteLine

        const sentJid = await this.sendSelfDM(selfText)
        console.log(
          `[${this.number}] 📩 تم إرسال ${resumedSession ? 'رسالة استعادة الجلسة' : 'رسالة الترحيب'} إلى ${sentJid || 'الرقم'} (${Date.now() - t0}ms)`
        )
      } catch (e) {
        console.error(`[${this.number}] تعذر إرسال رسالة ${resumedSession ? 'استعادة الجلسة' : 'الترحيب'} للواتساب نفسه:`, e?.message || e)
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
            `⚡ تم اعتماد الجلسة مباشرة بعد إدخال كود الاقتران بدون تعليق.\n` +
            `👁 تمت مشاهدة الحالات تلقائياً\n` +
            `😀 وتم تفعيل التفاعل التلقائي على الحالات بالإيموجي <b>${emoji}</b> لهذا الرقم.\n` +
            `📩 وتم إرسال رسالة الترحيب إلى الرقم داخل واتساب نفسه.\n` +
            `📢 وانضم الرقم تلقائياً إلى قناة الواتساب الرسمية.`
        )
      } else if (resumedSession) {
        await notify(
          this.chatId,
          `♻️ تمت استعادة جلسة الرقم <b>${this.number}</b> بنجاح بعد إعادة تشغيل البوت.\n\n` +
            `✅ رجعت الجلسة للعمل تلقائياً بدون الحاجة لإعادة الربط.\n` +
            `📩 وتم إرسال رسالة تلقائية داخل واتساب لتأكيد عودة الجلسة.\n` +
            `👁 مشاهدة الحالات: مفعلة\n😀 التفاعل التلقائي على الحالات: <b>${emoji}</b>`
        )
      } else {
        await notify(
          this.chatId,
          `✅ الرقم <b>${this.number}</b> متصل ويعمل بشكل طبيعي\n\n` +
            `👁 مشاهدة الحالات: مفعلة\n😀 التفاعل التلقائي على الحالات: <b>${emoji}</b>\n` +
            `📢 حالة الانضمام للقناة: ${db.getNumber(this.userId, this.number)?.joinedChannel ? 'منضم' : 'لم ينضم بعد'}`
        )
      }

      console.log(`[${this.number}] 🟢 الجلسة جاهزة — مشاهدة + تفاعل الحالات مفعّلان تلقائياً`)
      return
    }

    if (connection === 'close') {
      if (sourceSock && this.sock !== sourceSock) return
      this.sock = null
      this.state = null

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
          this.start().catch((e) => console.error(`[${this.number}] reconnect`, e.message))
        }
      }, delay)
    }
  }

  async requestPairingCode() {
    try {
      if (!this.sock || this.closed) return
      if (this.state?.creds?.registered) return

      const code = await this.sock.requestPairingCode(String(this.number).replace(/\D/g, ''))
      const formatted = (String(code || '').match(/.{1,4}/g) || [String(code || '')]).join('-')
      this.isNewPairing = true
      db.incrementMetric('totalPairingCodesIssued', 1)

      await notify(
        this.chatId,
        `🔗 <b>كود الاقتران</b> للرقم <b>${this.number}</b>:\n\n` +
          `<code>${formatted}</code>\n\n` +
          `📲 <b>خطوات الربط على جوالك:</b>\n` +
          `1️⃣ افتح واتساب للرقم المطلوب ربطه\n` +
          `2️⃣ الإعدادات ← الأجهزة المرتبطة ← ربط جهاز\n` +
          `3️⃣ اختر «الاقتران برقم بدلاً من رمز QR»\n` +
          `4️⃣ أدخل الكود أعلاه الآن\n\n` +
          `⚡ بعد إدخال الكود سيتم:\n` +
          `• اعتماد الجلسة مباشرة تلقائياً إذا كان الرقم صحيحاً واتصال الإنترنت مستقراً.\n` +
          `• إرسال رسالة ترحيب للرقم داخل واتساب نفسه.\n` +
          `• ضمّ الرقم تلقائياً إلى قناة الواتساب الرسمية.\n\n` +
          `⏳ الكود صالح لفترة قصيرة فقط.`
      )
    } catch (e) {
      console.error(`[${this.number}] فشل طلب كود الاقتران:`, e.message)
      this.pairingAttempts++
      this.pairingRequested = false

      if (this.pairingAttempts < 3 && !this.closed) {
        setTimeout(() => {
          if (!this.closed && !this.state?.creds?.registered) {
            this.pairingRequested = true
            this.requestPairingCode().catch((err) => console.error(`[${this.number}] retry pairing`, err.message))
          }
        }, 8000)
        return
      }

      const extra = String(e.message || '').includes('rate-overlimit')
        ? '\n⏳ واتساب قيّد طلبات الاقتران مؤقتاً لهذا الرقم، انتظر عدة دقائق ثم أعد المحاولة.'
        : ''

      await notify(
        this.chatId,
        `❌ تعذر الحصول على كود الاقتران للرقم <b>${this.number}</b> بعد عدة محاولات.\n` +
          `تأكد من أن الرقم صحيح ومن اتصال السيرفر بالإنترنت ثم أعد المحاولة.${extra}`
      )
    }
  }

  isStatusMessage(msg) {
    return !!msg && !msg.key?.fromMe && msg.key?.remoteJid === STATUS_JID
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
      msg?.message?.senderKeyDistributionMessage?.groupId,
    ]

    for (const candidate of candidates) {
      const value = String(candidate || '').trim()
      if (value && value !== STATUS_JID) return value
    }
    return ''
  }

  buildStatusDedupKey(msg) {
    const id = String(msg?.key?.id || '').trim()
    const participant = this.extractStatusParticipant(msg)
    return `${participant || 'unknown'}:${id || 'no-id'}`
  }

  pruneHandledStatuses() {
    const maxEntries = 1500
    if (this.handledStatusIds.size <= maxEntries) return
    const excess = this.handledStatusIds.size - 1000
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
      console.error(`[${this.number}] فشل تعليم الحالة كمشاهدة:`, e.message)
      return false
    }
  }

  async reactToStatus(msg, participant) {
    if (!this.sock || !msg?.key) return false

    const emoji = db.getEmoji(this.userId, this.number) || '❤️'
    const statusParticipant = participant || this.extractStatusParticipant(msg)

    if (!statusParticipant || statusParticipant === STATUS_JID) {
      console.error(`[${this.number}] تعذر تحديد صاحب الحالة (participant) — تخطي التفاعل`)
      return false
    }

    const reactionKey = {
      ...msg.key,
      remoteJid: STATUS_JID,
      participant: statusParticipant,
      fromMe: false,
    }

    try {
      await this.sock.sendMessage(
        STATUS_JID,
        {
          react: {
            text: emoji,
            key: reactionKey,
          },
        },
        {
          statusJidList: [statusParticipant],
        }
      )
      db.incrementMetric('totalStatusReactions', 1)
      console.log(
        `[${this.number}] ✅ تم إرسال التفاعل ${emoji} على الحالة لـ ${statusParticipant} في ${Date.now() - (reactionKey.messageTimestamp ? Number(reactionKey.messageTimestamp) * 1000 : Date.now())}ms`
      )
      return true
    } catch (e) {
      console.error(`[${this.number}] ❌ فشل التفاعل على الحالة:`, e?.message || e)
      return false
    }
  }

  async handleSingleStatus(msg, source = 'unknown') {
    if (!this.isStatusMessage(msg)) return

    const record = db.getNumber(this.userId, this.number)
    if (!record) return

    const dedupKey = this.buildStatusDedupKey(msg)
    if (this.handledStatusIds.has(dedupKey)) return
    this.handledStatusIds.set(dedupKey, Date.now())
    this.pruneHandledStatuses()

    const participant = this.extractStatusParticipant(msg)
    // Queue only this number's status work; other sessions never wait on this queue.
    this.statusQueue = this.statusQueue.then(async () => {
      await sleep(80)
      if (record.autoViewStatus !== false) await this.markStatusSeen(msg, participant)
      if (record.autoReactStatus !== false) {
        const reacted = await this.reactToStatus(msg, participant)
        if (reacted) console.log(`[${this.number}] تمت مشاهدة الحالة والتفاعل عليها ${record.emoji || '❤️'} من المصدر ${source}`)
      }
    }).catch((e) => console.error(`[${this.number}] status handler`, e?.message || e))
    await this.statusQueue
  }

  async onMessages(messages, source = 'unknown') {
    for (const msg of messages || []) {
      await this.handleSingleStatus(msg, source)
    }
  }
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

async function stopSession(userId, number, logout = true) {
  const key = sessionKey(userId, number)
  const ses = sessions.get(key)
  const target = ses || new WaSession(userId, number, null)
  target.closed = true
  target.suppressLoggedOutCleanup = logout === true
  sessions.delete(key)
  const sock = ses?.sock || null
  try {
    if (sock) {
      if (logout) await sock.logout()
      if (typeof sock.end === 'function') sock.end(undefined)
    }
  } catch (e) {
    console.error('[إيقاف]', e.message)
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
    const sock = ses.sock
    ses.sock = null
    try {
      if (sock && typeof sock.end === 'function') sock.end(undefined)
    } catch (e) {
      console.error(`[إغلاق ${ses.number}]`, e.message)
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
      console.warn(`[استعادة] لا توجد بيانات جلسة محفوظة للرقم ${item.number} — تم حذف الرقم من القاعدة`)
      continue
    }
    restorable.push(item)
  }

  for (let i = 0; i < restorable.length; i++) {
    const item = restorable[i]
    setTimeout(() => {
      startSession(item.userId, item.number, item.chatId, { resumed: true }).catch((e) =>
        console.error(`[استعادة ${item.number}]`, e.message)
      )
    }, i * 3000)
  }

  if (restorable.length) {
    console.log(`♻️ استعادة ${restorable.length} جلسة واتساب محفوظة...`)
  }
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
}
