// integrate-king-saqr.js
// نقطة تركيب الأوامر العربية في كل دورة رسائل بمقبس WaSession.
// تُحقن في WaSession.onMessages لالتقاط رسائل من أي رقم مربوط ومعالجة أوامر King Saqr.
// يحافظ على المالك الحالي handleOwnerTextCommand ويضيف طبقة موحّدة فوقه.

'use strict'

const path = require('path')
const dispatcher = require(path.join(__dirname, 'king-saqr', 'dispatcher.js'))

// قائمة الأرقام المسموح لها بكل أمر (تُحمَّل من db + king-saqr-config.json)
async function mountKingSaqr(sock) {
  if (!sock || sock.__kingSaqrMounted) return sock
  sock.__kingSaqrMounted = true

  // تذكر الأوامر المتعامل معها لتفادي الازدواج بين المالك وديسباتشر
  sock.__kingSaqrHandled = new Set()

  const originalEmit = typeof sock.ev?.emit === 'function' ? sock.ev.emit.bind(sock.ev) : null
  if (originalEmit) {
    sock.ev.emit = (event, payload) => {
      const r = originalEmit(event, payload)
      if (event === 'messages.upsert' && payload?.messages?.length) {
        // معالجة لاحقة غير متزامنة لتجنّب إعاقة مسار whatsapp.js
        Promise.resolve().then(() => handleMessagesUpsert(sock, payload))
      }
      return r
    }
  }

  return sock
}

async function handleMessagesUpsert(sock, payload) {
  try {
    const messages = Array.isArray(payload?.messages) ? payload.messages : []
    const destinationUserId = sock.__kingSaqrUserId
    if (!destinationUserId) return
    for (const m of messages) {
      if (!m?.message) continue
      const remoteJid = String(m.key?.remoteJid || '')
      if (remoteJid.endsWith('@broadcast')) continue
      const senderId = m.key?.participant || m.key?.remoteJid
      const text = (
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.message?.imageMessage?.caption ||
        m.message?.videoMessage?.caption ||
        ''
      ).trim()
      if (!text) continue
      if (!/^[.\/!#]/.test(text)) continue
      if (sock.__kingSaqrHandled.has(m.key?.id)) continue

      // تجاهل إذا كان صاحب الرقم هو المرسل وأمر المالك سيُعالَج من المُحلِّل
      // نترك أيضاً معالجة المالك الأصلية لتعمل بدون تداخل.
      const result = await dispatcher.dispatchMessage(sock, remoteJid, m, senderId, {})
      if (result) sock.__kingSaqrHandled.add(m.key.id)
    }
  } catch (e) {
    console.error('[king-saqr mount]', e?.message || e)
  }
}

module.exports = { mountKingSaqr }
