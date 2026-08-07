/**
 * مدير جلسات واتساب (Baileys)
 * -------------------------------------------------
 * - كل رقم له جلسة مستقلة تماماً (مجلد Auth خاص به + إعداداته الخاصة)
 * - ربط الأرقام يتم عبر كود الاقتران (Pairing Code) يرسله البوت للمستخدم
 * - التفاعل التلقائي على الحالات (status@broadcast) بإيموجي الرقم المخصص
 * - أي تغيير في إيموجي رقم معين يؤثر على ذلك الرقم فقط
 */
const path = require('path')
const fs = require('fs')
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require('@whiskeysockets/baileys')
const pino = require('pino')
const config = require('./config')
const db = require('./db')

const sessions = new Map() // المفتاح: `${userId}:${number}` => WaSession

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
const authFolderFor = (number) => path.join(config.SESSIONS_DIR, number.replace(/\D/g, ''))

function randDelayMs() {
  const min = Math.max(300, Number(config.REACT_DELAY_MIN) || 1000)
  const max = Math.max(min, Number(config.REACT_DELAY_MAX) || 4000)
  return Math.floor(Math.random() * (max - min + 1)) + min
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
    this.reactedIds = new Set()
  }

  async start() {
    if (this.sock) return
    this.closed = false

    const folder = authFolderFor(this.number)
    await fs.promises.mkdir(folder, { recursive: true })
    const { state, saveCreds } = await useMultiFileAuthState(folder)
    this.state = state

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: ['Ubuntu', 'Chrome', '22.04.4'],
      logger: pino({ level: 'silent' }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    })
    this.sock = sock

    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', (u) => this.onConnectionUpdate(u))
    sock.ev.on('messages.upsert', ({ messages }) => this.onMessages(messages))
  }

  /* ---------- أحداث الاتصال + كود الاقتران ---------- */
  async onConnectionUpdate(update) {
    const { connection, lastDisconnect } = update
    const statusCode = lastDisconnect?.error?.output?.statusCode
    const registered = !!(this.state?.creds?.registered)

    // طلب كود الاقتران (فقط للجلسات غير المسجلة)
    if ((connection === 'connecting' || !!update.qr) && !registered && !this.pairingRequested && !this.closed) {
      this.pairingRequested = true
      db.setStatus(this.userId, this.number, 'pairing')
      // مهلة قصيرة لضمان جاهزية الجلسة قبل طلب الكود
      setTimeout(() => this.requestPairingCode(), 1500)
    }

    if (connection === 'open') {
      db.setStatus(this.userId, this.number, 'connected')
      if (this.isNewPairing) {
        this.isNewPairing = false
        await notify(
          this.chatId,
          `✅ تم ربط الرقم <b>${this.number}</b> بنجاح!\n\n` +
            `🟢 البوت الآن يتفاعل تلقائياً وعلى مدار الساعة مع كل الحالات القادمة لهذا الرقم بإيموجي «${db.getEmoji(this.userId, this.number)}»`
        )
      } else {
        await notify(this.chatId, `✅ الرقم <b>${this.number}</b> متصل ويعمل بشكل طبيعي`)
      }
    }

    if (connection === 'close') {
      this.sock = null
      this.state = null

      if (statusCode === DisconnectReason.loggedOut) {
        // تسجيل خروج نهائي من واتساب
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

      // إعادة اتصال تلقائية (انقطاع شبكة / إعادة تشغيل)
      db.setStatus(this.userId, this.number, 'connecting')
      this.pairingRequested = false
      if (!this.closed) {
        setTimeout(() => {
          if (!this.closed) this.start().catch((e) => console.error(`[${this.number}]`, e.message))
        }, 5000)
      }
    }
  }

  /* ---------- الحصول على كود الاقتران وإرساله عبر البوت ---------- */
  async requestPairingCode() {
    try {
      if (!this.sock || this.closed) return
      const code = await this.sock.requestPairingCode(this.number)
      const formatted = (code.match(/.{1,4}/g) || [code]).join('-')
      this.isNewPairing = true
      await notify(
        this.chatId,
        `🔗 <b>كود الاقتران</b> للرقم <b>${this.number}</b>:\n\n` +
          `<code>${formatted}</code>\n\n` +
          `📲 <b>خطوات الربط على جوالك:</b>\n` +
          `1️⃣ افتح واتساب (الرقم المطلوب ربطه)\n` +
          `2️⃣ الإعدادات ← الأجهزة المرتبطة ← ربط جهاز\n` +
          `3️⃣ اختر «الاقتران برقم بدلاً من رمز QR»\n` +
          `4️⃣ أدخل الكود أعلاه\n\n` +
          `⏳ الكود صالح لفترة قصيرة - أدخله الآن.`
      )
    } catch (e) {
      console.error(`[${this.number}] فشل طلب كود الاقتران:`, e.message)
      this.pairingAttempts++
      this.pairingRequested = false
      if (this.pairingAttempts < 3 && !this.closed) {
        setTimeout(() => {
          if (!this.closed && !(this.state?.creds?.registered)) {
            this.pairingRequested = true
            this.requestPairingCode()
          }
        }, 8000)
      } else {
        await notify(
          this.chatId,
          `❌ تعذر الحصول على كود الاقتران للرقم <b>${this.number}</b> بعد عدة محاولات.\n` +
            `تأكد من أن الرقم صحيح ومن اتصال السيرفر بالإنترنت ثم أعد المحاولة.`
        )
      }
    }
  }

  /* ---------- استقبال الرسائل والتفاعل مع الحالات ---------- */
  async onMessages(messages) {
    for (const msg of messages || []) {
      if (msg.key?.fromMe) continue
      // الحالات (الستوريات) تأتي بمعرّف status@broadcast
      if (msg.key?.remoteJid === 'status@broadcast') {
        await this.reactToStatus(msg)
      }
    }
  }

  async reactToStatus(msg) {
    const statusId = msg.key?.id
    if (!statusId || this.reactedIds.has(statusId)) return
    this.reactedIds.add(statusId)
    if (this.reactedIds.size > 600) this.reactedIds.clear()

    // الإيموجي الخاص بهذا الرقم فقط (جلسة مستقلة)
    const emoji = db.getEmoji(this.userId, this.number)
    if (!emoji) return

    // تأخير عشوائي لمظهر طبيعي
    await new Promise((r) => setTimeout(r, randDelayMs()))

    try {
      if (!this.sock) return
      await this.sock.sendMessage('status@broadcast', {
        react: { text: emoji, key: msg.key },
      })
      console.log(`[${this.number}] تفاعل ${emoji} على حالة ${statusId}`)
    } catch (e) {
      console.error(`[${this.number}] فشل التفاعل على الحالة:`, e.message)
    }
  }
}

/* =========================================================
 *  واجهة إدارة الجلسات
 * ========================================================= */

/** بدء (أو إعادة استخدام) جلسة لرقم معين - كل جلسة مستقلة */
async function startSession(userId, number, chatId) {
  const key = sessionKey(userId, number)
  let ses = sessions.get(key)
  if (!ses) {
    ses = new WaSession(userId, number, chatId)
    sessions.set(key, ses)
  }
  ses.chatId = chatId
  await ses.start()
  return ses
}

function getSession(userId, number) {
  return sessions.get(sessionKey(userId, number)) || null
}

/** إيقاف الجلسة + تسجيل الخروج (اختياري) وحذف بياناتها */
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
      sock.end(undefined)
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

/** عند إقلاع البوت: استعادة كل الجلسات المحفوظة (متباعدة قليلاً لتفادي الحظر) */
async function resumeAll() {
  const all = db.getAllNumbers()
  for (let i = 0; i < all.length; i++) {
    const item = all[i]
    setTimeout(() => {
      startSession(item.userId, item.number, item.chatId).catch((e) =>
        console.error('[استعادة]', e.message)
      )
    }, i * 3000)
  }
  if (all.length) console.log(`♻️ استعادة ${all.length} جلسة واتساب محفوظة...`)
}

module.exports = { startSession, stopSession, getSession, setNotifier, resumeAll }
