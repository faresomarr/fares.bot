// king-saqr/hook.js
// نقطة الربط بين dispatcher.js وموزع whatsapp.js داخل WaSession.
// يكفي استدعاء installKingSaqrHooks(sock) مرة واحدة بعد تهيئة المالك إن أردت
// تجربة الموجّه العربي مباشرة من رسائل المالك، وإلا فإن المُحلِّل الحالي
// يدعم بالفعل جميع الأوامر العربية في ConnectionNumberHandlers.handleOwnerTextCommand.

'use strict'

const path = require('path')

function attach(sock, ctx = {}) {
  sock.kingSaqrHooked = true

  const dispatcher = require(path.join(__dirname, 'dispatcher.js'))
  const originalDispatch = sock.__kingSaqrOriginalDispatch

  sock.use?.((event, payload) => {
    if (event !== 'messages.upsert') return
    try {
      const messages = payload?.messages || []
      for (const m of messages) {
        if (!m?.message) continue
        if (String(m.key?.remoteJid || '').endsWith('@broadcast')) continue
        const chatId = m.key.remoteJid
        const senderId = m.key.participant || m.key.remoteJid
        const prefix = String(ctx.prefix || '.').trim() || '.'
        // فقط إذا بدأ بالبادئة
        const text = (m.message?.conversation || m.message?.extendedTextMessage?.text || '')
        if (!text.startsWith(prefix) && !/^[.#!/]/.test(text)) continue
        // ملاحظة: handleOwnerTextCommand في whatsapp.js يعالج بالفعل
        // كل هذه الأوامر برسالة عربية ضمن صلاحيات المالك.
        // dispatcher هنا فقط وسيلة اختيارية لتسريع الربط من خارج المُحلِّل.
        dispatcher.dispatchMessage(sock, chatId, m, senderId, { prefix })
      }
    } catch {}
  })

  return sock
}

module.exports = { attach }
