const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const config = require('./config')

const DEFAULT_EMOJI = '❤️'
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

let data = {
  users: {},
  comments: [],
  metrics: { ...DEFAULT_METRICS },
  meta: {
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
}

function normalizeNumber(raw) {
  return String(raw || '').replace(/\D/g, '')
}

function createId(prefix) {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function touch() {
  if (!data.meta || typeof data.meta !== 'object') data.meta = {}
  if (!data.meta.createdAt) data.meta.createdAt = Date.now()
  data.meta.updatedAt = Date.now()
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

function ensureStructure() {
  if (!data || typeof data !== 'object') data = {}
  if (!data.users || typeof data.users !== 'object') data.users = {}
  if (!Array.isArray(data.comments)) data.comments = []
  if (!data.meta || typeof data.meta !== 'object') data.meta = {}
  if (!data.meta.createdAt) data.meta.createdAt = Date.now()
  if (!data.meta.updatedAt) data.meta.updatedAt = Date.now()
  data.metrics = normalizeMetrics(data.metrics)

  for (const [userId, user] of Object.entries(data.users)) {
    data.users[userId] = normalizeUserRecord(userId, user)
  }

  data.comments = data.comments
    .map((comment) => normalizeComment(comment))
    .filter((comment) => comment.message)
    .sort((a, b) => b.createdAt - a.createdAt)
}

function load() {
  try {
    if (fs.existsSync(file)) {
      data = JSON.parse(fs.readFileSync(file, 'utf8'))
    }
  } catch (e) {
    console.error('⚠️ خطأ في قراءة قاعدة البيانات:', e.message)
    data = {
      users: {},
      comments: [],
      metrics: { ...DEFAULT_METRICS },
      meta: { createdAt: Date.now(), updatedAt: Date.now() },
    }
  }

  ensureStructure()
  save()
}

function save() {
  try {
    touch()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.renameSync(tmp, file)
  } catch (e) {
    console.error('⚠️ خطأ في حفظ قاعدة البيانات:', e.message)
  }
}

function ensureUser(userId, chatId) {
  if (!data.users[userId]) {
    data.users[userId] = normalizeUserRecord(userId, { userId, chatId: chatId || null, numbers: [] })
    save()
  } else if (chatId && data.users[userId].chatId !== chatId) {
    data.users[userId].chatId = chatId
    save()
  }
  return data.users[userId]
}

function getUser(userId) {
  return data.users[userId] || null
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
  save()
  return n
}

function getEmoji(userId, number) {
  const n = getNumber(userId, number)
  return n ? n.emoji || DEFAULT_EMOJI : DEFAULT_EMOJI
}

function setStatus(userId, number, status) {
  const n = getNumber(userId, number)
  if (!n) return
  n.status = status
  save()
}

function setJoinedChannel(userId, number, value) {
  const n = getNumber(userId, number)
  if (!n) return
  n.joinedChannel = value === true
  save()
  return n
}

function removeNumber(userId, number) {
  const normalized = normalizeNumber(number)
  const u = getUser(userId)
  if (!u) return
  u.numbers = (u.numbers || []).filter((n) => n.number !== normalized)
  save()
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

module.exports = {
  DEFAULT_EMOJI,
  load,
  ensureUser,
  getUser,
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
  addComment,
  getCommentById,
  replyToComment,
  listComments,
  getCommentStats,
}
