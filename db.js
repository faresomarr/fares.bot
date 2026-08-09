const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { MongoClient } = require('mongodb')
const { BufferJSON } = require('@whiskeysockets/baileys')
const config = require('./config')

const DEFAULT_EMOJI = '❤️'
const PANEL_SESSION_TTL_MS = 1000 * 60 * 60 * 12 // 12h
const PANEL_SALT = 'fares-bot-panel-salt-v1'
const file = config.DB_FILE

const DEFAULT_METRICS = {
  startedAt: Date.now(),
  totalPairingCodesIssued: 0,
  totalSuccessfulLinks: 0,
  totalReconnects: 0,
  totalStatusViews: 0,
  totalStatusReactions: 0,
  totalSelfMessages: 0,
  totalChannelJoinAttempts: 0,
  totalChannelJoinSuccess: 0,
  totalBroadcastsTelegram: 0,
  totalBroadcastsWhatsapp: 0,
  totalBroadcastRecipientsTelegram: 0,
  totalBroadcastRecipientsWhatsapp: 0,
}

const DEFAULT_SETTINGS = {
  startMessage:
    '👋 أهلًا بك في بوت التفاعل مع الحالات!\n\n' +
    '📌 <b>ماذا يفعل البوت:</b>\n' +
    '• تربط رقم واتساب عبر كود الاقتران من داخل البوت مباشرة\n' +
    '• يتفاعل البوت تلقائياً وبشكل مستمر على حالات (ستوريات) جهات اتصالك خلال ثانية واحدة\n' +
    '• كل رقم له جلسة مستقلة وإيموجي تفاعل خاص به لا يتأثر بغيره\n' +
    '• بعد نجاح الربط:\n' +
    '↪️ يصل تأكيد للرقم داخل واتساب نفسه\n' +
    '↪️ ينضم الرقم تلقائياً إلى قناة الواتساب الرسمية',
}

// إعدادات افتراضية شاملة للرقم المربوط داخل واتساب (موقع الإعدادات والبوت)
const DEFAULT_PHONE_SETTINGS = {
  name: 'Golden Queen Bot',
  ownerNumber: String(process.env.DEFAULT_OWNER_NUMBER || config.DEVELOPER_WHATSAPP || '').trim(),
  ownername: 'Golden Queen Bot',
  description: 'Hi I am using Golden Queen Bot by NASIR.ABDULLAH.',
  from: 'Yemen',
  age: '24',
  prefix: '.',
  footer2: 'Golden Queen Bot',
  mode: 'private',
  antiBad: 'off',
  antiLink: 'off',
  autoRecording: 'off',
  autoTyping: 'off',
  alwaysOnline: 'off',
  autoStatusRead: 'on',
  autoStatusReact: 'on',
  statusReactionNotice: 'on',
  keepDeletedStatus: 'off',
  ghostMode: 'off',
  autoPrivateReact: 'off',
  autoRead: 'off',
  autoBlock: 'off',
  autoReact: 'off',
  autoVoice: 'off',
  antiDelete: 'off',
  sendDeleteTo: 'owner',
  antiCall: 'off',
  excludeCallNumbers: '',
  statusMsgSend: 'off',
  statusMsgType: 'default',
  customMsg: 'Hi I am using Golden Queen Bot by NASIR.ABDULLAH.',
  menu: '',
  alive: '',
  owner: '',
  statusCustomReact: '❤️',
  antiBug: 'off',
  antiBot: 'off',
  antiBotAction: 'delete',
  gaGroupJid: '',
  gaTimezone: 'Asia/Aden',
  gaCloseTime: '15:00',
  gaOpenTime: '05:00',
  customAutoReplies: '',
  autoSave: 'off',
  language: 'arabic',
  antiViewOnce: 'off',
  antiLinkList: 'wa.me,whatsapp.com',
  antiBadWords: 'huththa,ponna',
  antiMention: 'off',
  antiEdit: 'inbox',
  antiAction: 'wern',
  antiWarnCount: '3',
  autoReactScope: 'inbox',
  aiReplyScope: 'inbox',
  aliveMsg: '❖ *Golden Queen Bot is alive*',
  voiceFooter: 'https://github.com/monetheistmd/WEB_DATABASE/raw/main/AUD-20251229-WA0034.mp3',
}

let data = {
  users: {},
  comments: [],
  metrics: { ...DEFAULT_METRICS },
  settings: { ...DEFAULT_SETTINGS },
  meta: {
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
}

let mongoClient = null
let mongoDb = null
let stateCollection = null
let authCollection = null
let sessionCollection = null
let writeQueue = Promise.resolve()
let persistTimer = null
const panelSessions = new Map()

function normalizeNumber(raw) {
  return String(raw || '').replace(/\D/g, '')
}

function createId(prefix) {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function getSessionId(userId, number) {
  return `wa_session_${Number(userId)}_${normalizeNumber(number)}`
}

function getSessionScope(userId, number) {
  return `sessions/${Number(userId)}/${normalizeNumber(number)}`
}

function isRemoteStateEnabled() {
  return Boolean(stateCollection)
}

function isRemoteSessionStorageEnabled() {
  return Boolean(sessionCollection && authCollection)
}

function shouldWriteLocalState() {
  if (!config.MONGODB_URI) return true
  return config.WRITE_LOCAL_STATE_CACHE === true
}

function touch() {
  if (!data.meta || typeof data.meta !== 'object') data.meta = {}
  if (!data.meta.createdAt) data.meta.createdAt = Date.now()
  data.meta.updatedAt = Date.now()
}

function normalizePhoneSettings(raw) {
  const merged = { ...DEFAULT_PHONE_SETTINGS }
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(DEFAULT_PHONE_SETTINGS)) {
      if (raw[key] !== undefined && raw[key] !== null) {
        merged[key] = String(raw[key])
      }
    }
  }
  return merged
}

function normalizeNumberRecord(record = {}) {
  return {
    number: normalizeNumber(record.number),
    emoji:
      typeof record.emoji === 'string' && record.emoji.trim().length
        ? record.emoji.trim()
        : DEFAULT_EMOJI,
    linkedAt: Number(record.linkedAt || Date.now()),
    status: record.status || 'new',
    autoViewStatus: record.autoViewStatus !== false,
    autoReactStatus: record.autoReactStatus !== false,
    joinedChannel: record.joinedChannel === true,
    settings: normalizePhoneSettings(record.settings),
    panelPasswordHash: typeof record.panelPasswordHash === 'string' ? record.panelPasswordHash : null,
  }
}

function normalizeUserRecord(userId, user = {}) {
  return {
    userId: Number(user.userId || userId),
    chatId: user.chatId || null,
    dashboardMessageId: Number(user.dashboardMessageId || 0) || null,
    numbers: Array.isArray(user.numbers)
      ? user.numbers.map((item) => normalizeNumberRecord(item)).filter((item) => item.number)
      : [],
  }
}

function normalizeComment(comment = {}) {
  const reply = comment.reply && typeof comment.reply === 'object'
    ? {
        text: String(comment.reply.text || '').trim(),
        by: String(comment.reply.by || 'المطور').trim() || 'المطور',
        createdAt: Number(comment.reply.createdAt || comment.reply.at || 0) || null,
      }
    : null

  return {
    id: String(comment.id || createId('cmt')),
    name: String(comment.name || 'زائر').trim() || 'زائر',
    contact: String(comment.contact || '').trim(),
    message: String(comment.message || '').trim(),
    status: reply?.text ? 'replied' : comment.status === 'hidden' ? 'hidden' : 'open',
    createdAt: Number(comment.createdAt || Date.now()),
    updatedAt: Number(comment.updatedAt || comment.createdAt || Date.now()),
    reply: reply && reply.text ? reply : null,
  }
}

function normalizeMetrics(metrics = {}) {
  const out = { ...DEFAULT_METRICS }
  for (const key of Object.keys(out)) {
    const value = Number(metrics[key])
    out[key] = Number.isFinite(value) ? value : out[key]
  }
  if (!out.startedAt) out.startedAt = Date.now()
  return out
}

function normalizeSettings(settings = {}) {
  return {
    startMessage:
      typeof settings.startMessage === 'string' && settings.startMessage.trim().length
        ? settings.startMessage.trim()
        : DEFAULT_SETTINGS.startMessage,
  }
}

function ensureStructure() {
  if (!data || typeof data !== 'object') data = {}
  if (!data.users || typeof data.users !== 'object') data.users = {}
  if (!Array.isArray(data.comments)) data.comments = []
  if (!data.meta || typeof data.meta !== 'object') data.meta = {}
  if (!data.meta.createdAt) data.meta.createdAt = Date.now()
  if (!data.meta.updatedAt) data.meta.updatedAt = Date.now()
  data.metrics = normalizeMetrics(data.metrics)
  data.settings = normalizeSettings(data.settings)

  for (const [userId, user] of Object.entries(data.users)) {
    data.users[userId] = normalizeUserRecord(userId, user)
  }

  data.comments = data.comments
    .map((comment) => normalizeComment(comment))
    .filter((comment) => comment.message)
    .sort((a, b) => b.createdAt - a.createdAt)
}

function writeLocalFile() {
  try {
    touch()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.renameSync(tmp, file)
  } catch (e) {
    console.error('⚠️ خطأ في حفظ قاعدة البيانات المحلية:', e.message)
  }
}

function queueWrite(task) {
  writeQueue = writeQueue
    .then(() => task())
    .catch((e) => {
      console.error('⚠️ خطأ في مزامنة قاعدة البيانات:', e.message)
    })
  return writeQueue
}

async function connectMongoIfNeeded() {
  if (!config.MONGODB_URI) return false
  if (mongoDb && stateCollection && authCollection && sessionCollection) return true

  mongoClient = new MongoClient(config.MONGODB_URI, {
    ignoreUndefined: true,
    maxPoolSize: config.MONGO_POOL_SIZE,
    minPoolSize: Math.min(10, config.MONGO_POOL_SIZE),
    maxConnecting: Math.min(20, config.MONGO_POOL_SIZE),
  })

  await mongoClient.connect()
  mongoDb = mongoClient.db(config.MONGODB_DB_NAME)
  stateCollection = mongoDb.collection('app_state')
  authCollection = mongoDb.collection('wa_auth_state')
  sessionCollection = mongoDb.collection('wa_sessions')

  await Promise.all([
    stateCollection.createIndex({ updatedAt: 1 }),
    authCollection.createIndex({ sessionId: 1, file: 1 }, { unique: true }),
    authCollection.createIndex({ sessionId: 1, updatedAt: -1 }),
    sessionCollection.createIndex({ sessionId: 1 }, { unique: true }),
    sessionCollection.createIndex({ userId: 1, number: 1 }, { unique: true }),
    sessionCollection.createIndex({ updatedAt: -1 }),
  ])

  return true
}

async function saveRemoteState() {
  if (!stateCollection) return
  touch()
  await stateCollection.updateOne(
    { _id: 'main' },
    {
      $set: {
        payload: data,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true }
  )
}

async function persistStateNow() {
  if (isRemoteStateEnabled()) {
    await saveRemoteState()
  }
  if (shouldWriteLocalState()) {
    writeLocalFile()
  }
}

function schedulePersist() {
  touch()
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    queueWrite(async () => {
      await persistStateNow()
    })
  }, config.DB_WRITE_DEBOUNCE_MS)
}

function save() {
  schedulePersist()
}

async function flush() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
    await queueWrite(async () => {
      await persistStateNow()
    })
  }
  await writeQueue
}

function buildSessionDocument(userId, chatId, record) {
  const normalized = normalizeNumberRecord(record)
  return {
    sessionId: getSessionId(userId, normalized.number),
    scope: getSessionScope(userId, normalized.number),
    userId: Number(userId),
    chatId: chatId || null,
    number: normalized.number,
    linkedAt: normalized.linkedAt,
    status: normalized.status,
    emoji: normalized.emoji,
    autoViewStatus: normalized.autoViewStatus !== false,
    autoReactStatus: normalized.autoReactStatus !== false,
    joinedChannel: normalized.joinedChannel === true,
    settings: normalized.settings,
    updatedAt: new Date(),
  }
}

async function upsertSessionRecord(userId, chatId, record) {
  if (!sessionCollection || !record?.number) return false
  const doc = buildSessionDocument(userId, chatId, record)
  await queueWrite(async () => {
    await sessionCollection.updateOne(
      { sessionId: doc.sessionId },
      {
        $set: doc,
        $setOnInsert: {
          createdAt: new Date(doc.linkedAt || Date.now()),
        },
      },
      { upsert: true }
    )
  })
  return true
}

async function syncUserSessionChatId(userId, chatId) {
  if (!sessionCollection) return false
  await queueWrite(async () => {
    await sessionCollection.updateMany(
      { userId: Number(userId) },
      {
        $set: {
          chatId: chatId || null,
          updatedAt: new Date(),
        },
      }
    )
  })
  return true
}

async function removeSessionRecord(userId, number) {
  if (!sessionCollection) return false
  await queueWrite(async () => {
    await sessionCollection.deleteOne({ sessionId: getSessionId(userId, number) })
  })
  return true
}

async function syncSessionCollectionFromState() {
  if (!sessionCollection) return false
  const docs = []
  const liveSessionIds = new Set()

  for (const user of Object.values(data.users)) {
    for (const record of user.numbers || []) {
      const doc = buildSessionDocument(user.userId, user.chatId, record)
      liveSessionIds.add(doc.sessionId)
      docs.push(doc)
    }
  }

  await queueWrite(async () => {
    if (docs.length) {
      await sessionCollection.bulkWrite(
        docs.map((doc) => ({
          updateOne: {
            filter: { sessionId: doc.sessionId },
            update: {
              $set: doc,
              $setOnInsert: {
                createdAt: new Date(doc.linkedAt || Date.now()),
              },
            },
            upsert: true,
          },
        })),
        { ordered: false }
      )
    }

    const remoteSessionIds = await sessionCollection
      .find({}, { projection: { sessionId: 1 } })
      .toArray()

    const staleIds = remoteSessionIds
      .map((item) => item.sessionId)
      .filter((sessionId) => !liveSessionIds.has(sessionId))

    if (staleIds.length) {
      await sessionCollection.deleteMany({ sessionId: { $in: staleIds } })
    }
  })

  return true
}

async function load() {
  let localLoaded = false
  try {
    if (fs.existsSync(file)) {
      data = JSON.parse(fs.readFileSync(file, 'utf8'))
      localLoaded = true
    }
  } catch (e) {
    console.error('⚠️ خطأ في قراءة قاعدة البيانات المحلية:', e.message)
  }

  ensureStructure()

  const hasMongo = await connectMongoIfNeeded().catch((e) => {
    console.error('⚠️ فشل الاتصال بقاعدة MongoDB:', e.message)
    return false
  })

  if (hasMongo) {
    const remote = await stateCollection.findOne({ _id: 'main' })
    if (remote?.payload && typeof remote.payload === 'object') {
      data = remote.payload
      ensureStructure()
    } else {
      if (!localLoaded) {
        data = {
          users: {},
          comments: [],
          metrics: { ...DEFAULT_METRICS },
          settings: { ...DEFAULT_SETTINGS },
          meta: { createdAt: Date.now(), updatedAt: Date.now() },
        }
        ensureStructure()
      }
      await saveRemoteState()
    }

    await syncSessionCollectionFromState()

    if (shouldWriteLocalState()) {
      writeLocalFile()
    }
  } else if (!localLoaded) {
    writeLocalFile()
  } else {
    writeLocalFile()
  }
}

function ensureUser(userId, chatId) {
  if (!data.users[userId]) {
    data.users[userId] = normalizeUserRecord(userId, { userId, chatId: chatId || null, numbers: [] })
    save()
  } else if (chatId && data.users[userId].chatId !== chatId) {
    data.users[userId].chatId = chatId
    save()
    syncUserSessionChatId(userId, chatId).catch(() => {})
  }
  return data.users[userId]
}

function getUser(userId) {
  return data.users[userId] || null
}

function listUsers() {
  return Object.values(data.users).map((user) => ({
    ...user,
    numbers: (user.numbers || []).map((number) => ({ ...number })),
  }))
}

function getUserByChatId(chatId) {
  for (const user of Object.values(data.users)) {
    if (user.chatId === chatId) return user
  }
  return null
}

function setDashboardMessage(userId, messageId) {
  const user = ensureUser(userId)
  user.dashboardMessageId = Number(messageId || 0) || null
  save()
  return user.dashboardMessageId
}

function getDashboardMessage(userId) {
  return getUser(userId)?.dashboardMessageId || null
}

function clearDashboardMessage(userId) {
  const user = getUser(userId)
  if (!user) return
  user.dashboardMessageId = null
  save()
}

function numberOwner(number) {
  const normalized = normalizeNumber(number)
  for (const u of Object.values(data.users)) {
    const found = (u.numbers || []).find((n) => n.number === normalized)
    if (found) return u.userId
  }
  return null
}

function addNumber(userId, number, chatId) {
  const normalized = normalizeNumber(number)
  ensureUser(userId, chatId)
  const u = data.users[userId]

  if ((u.numbers || []).some((n) => n.number === normalized)) {
    throw new Error('already_linked')
  }

  const owner = numberOwner(normalized)
  if (owner !== null && owner !== userId) {
    throw new Error('linked_other')
  }

  u.numbers.push(
    normalizeNumberRecord({
      number: normalized,
      linkedAt: Date.now(),
      status: 'new',
      emoji: DEFAULT_EMOJI,
      joinedChannel: false,
    })
  )
  save()
  upsertSessionRecord(userId, u.chatId, getNumber(userId, normalized)).catch(() => {})
  return getNumber(userId, normalized)
}

function getNumber(userId, number) {
  const normalized = normalizeNumber(number)
  const u = getUser(userId)
  if (!u) return null
  return (u.numbers || []).find((n) => n.number === normalized) || null
}

function setEmoji(userId, number, emoji) {
  const n = getNumber(userId, number)
  if (!n) throw new Error('not_found')
  n.emoji = typeof emoji === 'string' && emoji.trim().length ? emoji.trim() : DEFAULT_EMOJI
  if (n.settings) n.settings.statusCustomReact = n.emoji
  save()
  upsertSessionRecord(userId, getUser(userId)?.chatId || null, n).catch(() => {})
  return n
}

function getEmoji(userId, number) {
  const n = getNumber(userId, number)
  if (!n) return DEFAULT_EMOJI
  return n.emoji || n.settings?.statusCustomReact || DEFAULT_EMOJI
}

function setStatus(userId, number, status) {
  const n = getNumber(userId, number)
  if (!n) return
  n.status = status
  save()
  upsertSessionRecord(userId, getUser(userId)?.chatId || null, n).catch(() => {})
}

function setJoinedChannel(userId, number, value) {
  const n = getNumber(userId, number)
  if (!n) return
  n.joinedChannel = value === true
  save()
  upsertSessionRecord(userId, getUser(userId)?.chatId || null, n).catch(() => {})
  return n
}

function removeNumber(userId, number) {
  const normalized = normalizeNumber(number)
  const u = getUser(userId)
  if (!u) return false
  const before = (u.numbers || []).length
  u.numbers = (u.numbers || []).filter((n) => n.number !== normalized)
  const removed = before !== u.numbers.length
  if (removed) {
    save()
    removeSessionRecord(userId, normalized).catch(() => {})
  }
  return removed
}

function getAllNumbers() {
  const out = []
  for (const u of Object.values(data.users)) {
    for (const n of u.numbers || []) {
      out.push({
        userId: u.userId,
        chatId: u.chatId,
        ...normalizeNumberRecord(n),
      })
    }
  }
  return out
}

function getAllChatIds() {
  const out = []
  const seen = new Set()
  for (const u of Object.values(data.users)) {
    if (u.chatId && !seen.has(u.chatId)) {
      seen.add(u.chatId)
      out.push(u.chatId)
    }
  }
  return out
}

// ===== إعدادات الرقم المربوط (موقع الإعدادات + أوامر المالك داخل الرقم) =====

function getPhoneSettings(userId, number) {
  const n = getNumber(userId, number)
  if (!n) return null
  return normalizePhoneSettings(n.settings)
}

function setPhoneSettings(userId, number, patch) {
  const n = getNumber(userId, number)
  if (!n) throw new Error('not_found')
  const current = normalizePhoneSettings(n.settings)
  const next = { ...current }
  if (patch && typeof patch === 'object') {
    for (const key of Object.keys(DEFAULT_PHONE_SETTINGS)) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        const value = patch[key]
        if (value === undefined || value === null) continue
        next[key] = String(value)
      }
    }
  }
  n.settings = next
  if (next.statusCustomReact && (!n.emoji || !n.emoji.trim())) {
    n.emoji = next.statusCustomReact.trim().split(',')[0] || DEFAULT_EMOJI
  }
  save()
  upsertSessionRecord(userId, getUser(userId)?.chatId || null, n).catch(() => {})
  return { ...next }
}

function setPhoneSetting(userId, number, key, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_PHONE_SETTINGS, key)) {
    throw new Error('unknown_setting')
  }
  return setPhoneSettings(userId, number, { [key]: value })
}

// ===== كلمات المرور للوحة الإعدادات =====

function hashPanelPassword(plain) {
  const safe = String(plain || '')
  if (!safe) return null
  return crypto.scryptSync(safe, PANEL_SALT, 32).toString('hex')
}

function verifyPanelPassword(hash, plain) {
  if (!hash) return false
  try {
    const a = Buffer.from(String(hash), 'hex')
    const candidate = hashPanelPassword(plain)
    if (!candidate) return false
    const b = Buffer.from(candidate, 'hex')
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function setPanelPassword(userId, number, plain) {
  const n = getNumber(userId, number)
  if (!n) throw new Error('not_found')
  const hash = hashPanelPassword(plain)
  if (!hash) throw new Error('invalid_password')
  n.panelPasswordHash = hash
  save()
  upsertSessionRecord(userId, getUser(userId)?.chatId || null, n).catch(() => {})
  return { ok: true }
}

function getDefaultPanelPasswordFor(number) {
  return String(number || '').replace(/\D/g, '')
}

// ===== جلسات دخول لوحة الإعدادات =====

function prunePanelSessions() {
  const now = Date.now()
  for (const [token, info] of panelSessions.entries()) {
    if (!info || !info.expiresAt || info.expiresAt < now) {
      panelSessions.delete(token)
    }
  }
}

function createPanelSession(userId, number) {
  prunePanelSessions()
  const token = crypto.randomBytes(24).toString('hex')
  panelSessions.set(token, {
    userId: Number(userId),
    number: normalizeNumber(number),
    createdAt: Date.now(),
    expiresAt: Date.now() + PANEL_SESSION_TTL_MS,
  })
  return token
}

function destroyPanelSession(token) {
  if (!token) return
  panelSessions.delete(String(token))
}

function getPanelSession(token) {
  prunePanelSessions()
  return panelSessions.get(String(token || '')) || null
}

function getMetrics() {
  ensureStructure()
  return { ...data.metrics }
}

function incrementMetric(name, amount = 1) {
  ensureStructure()
  if (!(name in data.metrics)) data.metrics[name] = 0
  data.metrics[name] = Number(data.metrics[name] || 0) + Number(amount || 0)
  save()
  return data.metrics[name]
}

function setMetric(name, value) {
  ensureStructure()
  data.metrics[name] = Number(value || 0)
  save()
  return data.metrics[name]
}

function getStartMessage() {
  ensureStructure()
  return data.settings.startMessage || DEFAULT_SETTINGS.startMessage
}

function setStartMessage(text) {
  ensureStructure()
  const cleaned = String(text || '').trim()
  data.settings.startMessage = cleaned || DEFAULT_SETTINGS.startMessage
  save()
  return data.settings.startMessage
}

function resetStartMessage() {
  data.settings.startMessage = DEFAULT_SETTINGS.startMessage
  save()
  return data.settings.startMessage
}

function addComment({ name, contact, message }) {
  const normalized = normalizeComment({
    id: createId('cmt'),
    name,
    contact,
    message,
    status: 'open',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })

  if (!normalized.message) {
    throw new Error('invalid_comment')
  }

  data.comments.unshift(normalized)
  save()
  return normalized
}

function getCommentById(commentId) {
  return data.comments.find((comment) => comment.id === String(commentId)) || null
}

function replyToComment(commentId, replyText, developerName = 'المطور') {
  const comment = getCommentById(commentId)
  if (!comment) throw new Error('comment_not_found')
  const text = String(replyText || '').trim()
  if (!text) throw new Error('invalid_reply')

  comment.reply = {
    text,
    by: String(developerName || 'المطور').trim() || 'المطور',
    createdAt: Date.now(),
  }
  comment.status = 'replied'
  comment.updatedAt = Date.now()
  save()
  return comment
}

function listComments({ includeHidden = false } = {}) {
  ensureStructure()
  return data.comments
    .filter((comment) => includeHidden || comment.status !== 'hidden')
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((comment) => ({ ...comment }))
}

function getCommentStats() {
  const comments = listComments({ includeHidden: true })
  const totalComments = comments.length
  const repliedComments = comments.filter((item) => item.reply?.text).length
  const pendingReplies = comments.filter((item) => !item.reply?.text && item.status !== 'hidden').length
  return {
    totalComments,
    repliedComments,
    pendingReplies,
  }
}

function getStats(runtime = {}) {
  let totalUsers = 0
  let totalNumbers = 0
  let connected = 0
  let pairing = 0
  let connecting = 0
  let loggedOut = 0
  let channelJoined = 0

  for (const u of Object.values(data.users)) {
    if ((u.numbers || []).length > 0 || u.chatId) totalUsers++
    for (const n of u.numbers || []) {
      totalNumbers++
      if (n.status === 'connected') connected++
      else if (n.status === 'pairing') pairing++
      else if (n.status === 'connecting') connecting++
      else if (n.status === 'logged_out') loggedOut++
      if (n.joinedChannel === true) channelJoined++
    }
  }

  const metrics = getMetrics()
  const comments = getCommentStats()
  const channelJoinRate = totalNumbers ? Number(((channelJoined / totalNumbers) * 100).toFixed(2)) : 0
  const connectedRate = totalNumbers ? Number(((connected / totalNumbers) * 100).toFixed(2)) : 0
  const repliedRate = comments.totalComments
    ? Number(((comments.repliedComments / comments.totalComments) * 100).toFixed(2))
    : 0

  return {
    totalUsers,
    totalNumbers,
    connected,
    pairing,
    connecting,
    loggedOut,
    channelJoined,
    channelJoinRate,
    connectedRate,
    comments,
    metrics,
    runtime: {
      activeSessions: Number(runtime.activeSessions || 0),
      uptimeMs: Number(runtime.uptimeMs || 0),
      startedAt: Number(runtime.startedAt || metrics.startedAt || Date.now()),
      siteUrl: runtime.siteUrl || config.WEBSITE_URL || '',
    },
    health: {
      repliedRate,
      pendingComments: comments.pendingReplies,
    },
    lastUpdatedAt: Number(data.meta.updatedAt || Date.now()),
  }
}

function serializeAuthPayload(payload) {
  return JSON.stringify(payload, BufferJSON.replacer)
}

function deserializeAuthPayload(raw) {
  if (!raw) return null
  return JSON.parse(raw, BufferJSON.reviver)
}

async function applyWaAuthMutations(sessionId, mutations = []) {
  if (!authCollection || !Array.isArray(mutations) || !mutations.length) return false

  await queueWrite(async () => {
    const ops = []
    for (const mutation of mutations) {
      const fileName = String(mutation.fileName || mutation.file || '').trim()
      if (!fileName) continue
      if (mutation.value === null || mutation.value === undefined) {
        ops.push({
          deleteOne: {
            filter: { sessionId: String(sessionId), file: fileName },
          },
        })
        continue
      }

      ops.push({
        updateOne: {
          filter: { sessionId: String(sessionId), file: fileName },
          update: {
            $set: {
              scope: String(mutation.scope || `sessions/${String(sessionId).replace(/^wa_session_/, '').replace(/_/g, '/')}`),
              payload: serializeAuthPayload(mutation.value),
              updatedAt: new Date(),
            },
            $setOnInsert: {
              createdAt: new Date(),
            },
          },
          upsert: true,
        },
      })
    }

    if (ops.length) {
      await authCollection.bulkWrite(ops, { ordered: false })
    }
  })

  return true
}

async function setWaAuthFile(sessionId, fileName, value) {
  return applyWaAuthMutations(sessionId, [{ fileName, value }])
}

async function getWaAuthFile(sessionId, fileName) {
  if (!authCollection) return null
  const doc = await authCollection.findOne(
    { sessionId: String(sessionId), file: String(fileName) },
    { projection: { payload: 1 } }
  )
  return deserializeAuthPayload(doc?.payload)
}

async function removeWaAuthFile(sessionId, fileName) {
  return applyWaAuthMutations(sessionId, [{ fileName, value: null }])
}

async function clearWaAuthSession(sessionId) {
  if (!authCollection) return false
  await queueWrite(async () => {
    await authCollection.deleteMany({ sessionId: String(sessionId) })
  })
  return true
}

async function hasWaAuthSession(sessionId) {
  if (!authCollection) return false
  const count = await authCollection.countDocuments({ sessionId: String(sessionId), file: 'creds.json' }, { limit: 1 })
  return count > 0
}

function isMongoEnabled() {
  return Boolean(mongoDb && stateCollection && authCollection && sessionCollection)
}

function getDefaultPhoneSettings() {
  return { ...DEFAULT_PHONE_SETTINGS }
}

async function close() {
  try {
    await flush()
  } finally {
    if (mongoClient) {
      await mongoClient.close()
      mongoClient = null
      mongoDb = null
      stateCollection = null
      authCollection = null
      sessionCollection = null
    }
  }
}

module.exports = {
  DEFAULT_EMOJI,
  DEFAULT_PHONE_SETTINGS,
  load,
  save,
  flush,
  close,
  ensureUser,
  getUser,
  listUsers,
  getUserByChatId,
  setDashboardMessage,
  getDashboardMessage,
  clearDashboardMessage,
  addNumber,
  getNumber,
  setEmoji,
  getEmoji,
  setStatus,
  setJoinedChannel,
  removeNumber,
  getAllNumbers,
  getAllChatIds,
  numberOwner,
  getStats,
  getMetrics,
  incrementMetric,
  setMetric,
  getStartMessage,
  setStartMessage,
  resetStartMessage,
  addComment,
  getCommentById,
  replyToComment,
  listComments,
  getCommentStats,
  setWaAuthFile,
  getWaAuthFile,
  removeWaAuthFile,
  clearWaAuthSession,
  hasWaAuthSession,
  applyWaAuthMutations,
  getSessionId,
  getSessionScope,
  isMongoEnabled,
  isRemoteSessionStorageEnabled,
  getPhoneSettings,
  setPhoneSettings,
  setPhoneSetting,
  setPanelPassword,
  verifyPanelPassword,
  hashPanelPassword,
  getDefaultPanelPasswordFor,
  createPanelSession,
  destroyPanelSession,
  getPanelSession,
  getDefaultPhoneSettings,
}
