/**
 * مدير جلسات واتساب (Baileys)
 * -------------------------------------------------
 * - كل رقم له جلسة مستقلة تماماً (مجلد Auth خاص به + إعداداته الخاصة)
 * - ربط الأرقام يتم عبر كود الاقتران (Pairing Code) يُرسل إلى تيليجرام
 * - لحظة نجاح الربط:
 *     • يصل كود الترحيب تلقائياً إلى الرقم ذاته داخل واتساب (DM لنفسه)
 *     • ينضم الرقم تلقائياً إلى قناة الواتساب الرسمية
 * - مشاهدة + التفاعل على الحالات بأقصى سرعة ممكنة
 */
const path = require('path')
const fs = require('fs')
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
} = require('@whiskeysockets/baileys')
const pino = require('pino')
const config = require('./config')
const db = require('./db')

const STATUS_JID = 'status@broadcast'
const sessions = new Map() // المفتاح: `${userId}:${number}` => WaSession
let latestVersionPromise = null

/* ---------- الإشعارات إلى تيليجرام ---------- */
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

const sessionKey = (userId, number) => `${userId}:${number}`
const authFolderFor = (number) => path.join(config.SESSIONS_DIR, String(number || '').replace(/\D/g, ''))
const authCredsFileFor = (number) => path.join(authFolderFor(number), 'creds.json')

async function authStateExists(number) {
  try {
    await fs.promises.access(authCredsFileFor(number), fs.constants.F_OK)
    return true
  } catch {
    return false
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

/**
 * بناء قائمة بمرشحات JID لإرسال الرسالة لنفس الرقم داخل واتساب.
 * في Baileys v7 قد يكون sock.user.id بصيغة LID، لكن الرابط PN يعمل دائماً.
 */
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

/* =========================================================
 *  جلسة واتساب واحدة (رقم واحد)
 * ========================================================= */
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
  }

  async start(options = {}) {
    const resumed = options?.resumed === true
    this.closed = false
    this.resumeNotificationPending = resumed

    const folder = authFolderFor(this.number)
    await fs.promises.mkdir(folder, { recursive: true })
    const { state, saveCreds } = await useMultiFileAuthState(folder)
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

    sock.ev.on('creds.update', async () => {
      try {
        await saveCreds()
      } catch (e) {
        console.error(`[${this.number}] saveCreds`, e.message)
      }
    })

    sock.ev.on('connection.update', (u) => {
      this.onConnectionUpdate(u).catch((e) => console.error(`[${this.number}] connection.update`, e.message))
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

  /**
   * إرسال رسالة لنفس الرقم داخل واتساب (DM لنفسه).
   * يجرب عدة صيغ JID حتى يجد التي يقبلها الخادم.
   */
  async sendSelfDM(text) {
    if (!this.sock) return false
    const candidates = buildSelfJidCandidates(this.sock, this.number)
    let lastError = null
    for (const jid of candidates) {
      try {
        await this.sock.sendMessage(jid, { text })
        return jid
      } catch (e) {
        lastError = e
        console.error(`[${this.number}] فشل إرسال DM إلى ${jid}:`, e?.message || e)
      }
    }
    if (lastError) throw lastError
    return false
  }

  /**
   * الانضمام إلى قناة الواتساب باستخدام كود الدعوة.
   * يستخدم newsletterMetadata('invite', inviteCode) للحصول على JID ثم newsletterFollow.
   */
  async joinChannel() {
    if (!this.sock) return false
    const invite = String(config.WHATSAPP_CHANNEL_INVITE || '').trim()
    if (!invite) return false
    try {
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
      console.log(`[${this.number}] ✅ انضم إلى القناة ${newsletterJid}`)
      return newsletterJid
    } catch (e) {
      console.error(`[${this.number}] ❌ فشل الانضمام للقناة:`, e?.message || e)
      return false
    }
  }

  /* ---------- أحداث الاتصال + كود الاقتران ---------- */
  async onConnectionUpdate(update) {
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

      // ضمان تفعيل مشاهدة + تفاعل الحالات تلقائياً بعد الربط
      const record = db.getNumber(this.userId, this.number)
      if (record) {
        if (record.autoViewStatus === false) record.autoViewStatus = true
        if (record.autoReactStatus === false) record.autoReactStatus = true
        db.setEmoji(this.userId, this.number, emoji)
      }

      // 1) إرسال رسالة تأكيد إلى الرقم نفسه داخل واتساب
      // 2) الانضمام إلى القناة بشكل صامت بعد الربط/الاستعادة
      const t0 = Date.now()
      try {
        const selfText = resumedSession
          ? `♻️ تمت إعادة جلسة رقمك ${this.number} بنجاح بعد إعادة تشغيل البوت.\n\n` +
            `✅ رجعت الجلسة للعمل تلقائياً بدون إعادة ربط.\n` +
            `👁 مشاهدة الحالات: مفعلة\n` +
            `😀 التفاعل التلقائي على الحالات: ${emoji}\n\n` +
            `البوت رجع للعمل على هذا الرقم بشكل طبيعي الآن.`
          : `✅ تم ربط رقمك ${this.number} بنجاح!\n\n` +
            `👁 تم تفعيل مشاهدة الحالات تلقائياً\n` +
            `😀 تم تفعيل التفاعل التلقائي على الحالات بالإيموجي ${emoji} لهذا الرقم.\n\n` +
            `كل حالة جديدة ستصلك عليها علامة قراءة + قلب ${emoji} تلقائياً خلال ثانية واحدة.\n\n` +
            `📢 تم ضمّ الرقم تلقائياً إلى قناة الواتساب الرسمية.\n` +
            `💬 لأي استفسار كلّم المطور من داخل البوت عبر زر «مراسلة المطور».`

        const sentJid = await this.sendSelfDM(selfText)
        console.log(`[${this.number}] 📩 تم إرسال ${resumedSession ? 'رسالة استعادة الجلسة' : 'رسالة الترحيب'} إلى ${sentJid || 'الرقم'} (${Date.now() - t0}ms)`)
      } catch (e) {
        console.error(`[${this.number}] تعذر إرسال رسالة ${resumedSession ? 'استعادة الجلسة' : 'الترحيب'} للواتساب نفسه:`, e?.message || e)
      } finally {
        this.resumeNotificationPending = false
      }

      // الانضمام إلى القناة بشكل غير معيق (في الخلفية)
      this.joinChannel().catch(() => {})

      // إشعار المالك + تحديث لوحة المستخدم
      if (this.isNewPairing) {
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
      this.sock = null
      this.state = null

      if (statusCode === DisconnectReason.loggedOut) {
        db.setStatus(this.userId, this.number, 'logged_out')
        sessions.delete(sessionKey(this.userId, this.number))
        try {
          await fs.promises.rm(authFolderFor(this.number), { recursive: true, force: true })
        } catch {}
        await notify(
          this.chatId,
          `🚪 تم تسجيل خروج الرقم <b>${this.number}</b> من واتساب (حذف الجلسة).\nاربط الرقم مرة أخرى من البوت متى شئت.`
        )
        return
      }

      if (this.closed) return

      db.setStatus(this.userId, this.number, 'connecting')
      this.pairingRequested = false
      const delay = getReconnectDelay(statusCode)

      setTimeout(() => {
        if (!this.closed) {
          this.start().catch((e) => console.error(`[${this.number}] reconnect`, e.message))
        }
      }, delay)
    }
  }

  /* ---------- الحصول على كود الاقتران وإرساله عبر البوت ---------- */
  async requestPairingCode() {
    try {
      if (!this.sock || this.closed) return
      if (this.state?.creds?.registered) return

      const code = await this.sock.requestPairingCode(String(this.number).replace(/\D/g, ''))
      const formatted = (String(code || '').match(/.{1,4}/g) || [String(code || '')]).join('-')
      this.isNewPairing = true

      await notify(
        this.chatId,
        `🔗 <b>كود الاقتران</b> للرقم <b>${this.number}</b>:\n\n` +
          `<code>${formatted}</code>\n\n` +
          `📲 <b>خطوات الربط على جوالك:</b>\n` +
          `1️⃣ افتح واتساب للرقم المطلوب ربطه\n` +
          `2️⃣ الإعدادات ← الأجهزة المرتبطة ← ربط جهاز\n` +
          `3️⃣ اختر «الاقتران برقم بدلاً من رمز QR»\n` +
          `4️⃣ أدخل الكود أعلاه الآن\n\n` +
          `⚡ بعد إدخال الكود سيتم:
          • اعتماد الجلسة مباشرة تلقائياً إذا كان الرقم صحيحاً واتصال الإنترنت مستقراً.
          • إرسال رسالة ترحيب للرقم داخل واتساب نفسه.
          • ضمّ الرقم تلقائياً إلى قناة الواتساب الرسمية.

          ⏳ الكود صالح لفترة قصيرة فقط.`
      )
    } catch (e) {
      console.error(`[${this.number}] فشل طلب كود الاقتران:`, e.message)
      this.pairingAttempts++
      this.pairingRequested = false

      if (this.pairingAttempts < 3 && !this.closed) {
        setTimeout(() => {
          if (!this.closed && !(this.state?.creds?.registered)) {
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
      console.log(`[${this.number}] ✅ تم إرسال التفاعل ${emoji} على الحالة لـ ${statusParticipant} في ${Date.now() - (reactionKey.messageTimestamp ? Number(reactionKey.messageTimestamp) * 1000 : Date.now())}ms`)
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
    /* تأخير بسيط جداً بحيث يصبح التفاعل خلال أقل من ثانية، مع تخفيف الضغط */
    await sleep(80)

    if (record.autoViewStatus !== false) {
      await this.markStatusSeen(msg, participant)
    }

    if (record.autoReactStatus !== false) {
      const reacted = await this.reactToStatus(msg, participant)
      if (reacted) {
        console.log(
          `[${this.number}] تمت مشاهدة الحالة والتفاعل عليها ${record.emoji || '❤️'} من المصدر ${source}`
        )
      }
    }
  }

  /* ---------- استقبال الرسائل والتعامل مع الحالات ---------- */
  async onMessages(messages, source = 'unknown') {
    for (const msg of messages || []) {
      await this.handleSingleStatus(msg, source)
    }
  }
}

/* =========================================================
 *  واجهة إدارة الجلسات
 * ========================================================= */

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
  if (!ses) return false
  ses.closed = true
  sessions.delete(key)
  const sock = ses.sock
  try {
    if (sock) {
      if (logout) await sock.logout()
      if (typeof sock.end === 'function') sock.end(undefined)
    }
  } catch (e) {
    console.error('[إيقاف]', e.message)
  }
  if (logout) {
    try {
      await fs.promises.rm(authFolderFor(number), { recursive: true, force: true })
    } catch {}
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
    const hasAuth = await authStateExists(item.number)
    if (!hasAuth) {
      db.setStatus(item.userId, item.number, 'new')
      console.warn(`[استعادة] لا توجد بيانات جلسة محفوظة للرقم ${item.number} — تم تخطي الاستعادة`)
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

/**
 * إرسال رسالة نصية إلى جميع الأرقام المربوطة داخل واتساب.
 * يستثني الأرقام غير المتصلة ويعيد ملخص بالنجاح/الفشل.
 */
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
    /* فاصل بسيط لتفادي الـ rate-limit */
    await sleep(300)
  }
  return results
}

module.exports = {
  startSession,
  stopSession,
  getSession,
  setNotifier,
  resumeAll,
  shutdownAll,
  broadcastToWhatsapp,
  STATUS_JID,
}
