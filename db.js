/**
 * قاعدة بيانات بسيطة (JSON) لتخزين:
 * - أرقام كل مستخدم مع إيموجي التفاعل الخاص بكل رقم
 * - chatId لكل مستخدم لإرسال الإشعارات
 * كل رقم له إعداداته الخاصة => تغيير إيموجي رقم لا يؤثر على غيره
 */
const fs = require('fs')
const path = require('path')
const config = require('./config')

const file = config.DB_FILE
let data = { users: {} }

function load() {
  try {
    if (fs.existsSync(file)) {
      data = JSON.parse(fs.readFileSync(file, 'utf8'))
    }
  } catch (e) {
    console.error('⚠️ خطأ في قراءة قاعدة البيانات:', e.message)
    data = { users: {} }
  }
  if (!data.users) data.users = {}
  save()
}

function save() {
  try {
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
    data.users[userId] = { userId, chatId: chatId || null, numbers: [] }
    save()
  } else if (chatId) {
    data.users[userId].chatId = chatId
  }
  return data.users[userId]
}

function getUser(userId) {
  return data.users[userId] || null
}

// هل الرقم مربوط عند أي مستخدم آخر؟
function numberOwner(number) {
  for (const u of Object.values(data.users)) {
    const found = (u.numbers || []).find((n) => n.number === number)
    if (found) return u.userId
  }
  return null
}

function addNumber(userId, number, chatId) {
  ensureUser(userId, chatId)
  const u = data.users[userId]
  if ((u.numbers || []).some((n) => n.number === number)) {
    throw new Error('already_linked')
  }
  const owner = numberOwner(number)
  if (owner !== null && owner !== userId) {
    throw new Error('linked_other')
  }
  u.numbers.push({ number, emoji: '👍', linkedAt: Date.now(), status: 'new' })
  save()
  return getNumber(userId, number)
}

function getNumber(userId, number) {
  const u = getUser(userId)
  if (!u) return null
  return (u.numbers || []).find((n) => n.number === number) || null
}

function setEmoji(userId, number, emoji) {
  const n = getNumber(userId, number)
  if (!n) throw new Error('not_found')
  n.emoji = emoji
  save()
}

function getEmoji(userId, number) {
  const n = getNumber(userId, number)
  return n ? n.emoji : '👍'
}

function setStatus(userId, number, status) {
  const n = getNumber(userId, number)
  if (n) {
    n.status = status
    save()
  }
}

function removeNumber(userId, number) {
  const u = getUser(userId)
  if (!u) return
  u.numbers = (u.numbers || []).filter((n) => n.number !== number)
  save()
}

function getAllNumbers() {
  const out = []
  for (const u of Object.values(data.users)) {
    for (const n of u.numbers || []) {
      out.push({ userId: u.userId, chatId: u.chatId, ...n })
    }
  }
  return out
}

module.exports = {
  load,
  ensureUser,
  getUser,
  addNumber,
  getNumber,
  setEmoji,
  getEmoji,
  setStatus,
  removeNumber,
  getAllNumbers,
  numberOwner,
}
