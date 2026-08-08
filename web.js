const express = require('express')
const path = require('path')
const config = require('./config')
const db = require('./db')

function formatApiComment(comment) {
  return {
    id: comment.id,
    name: comment.name,
    contact: comment.contact,
    message: comment.message,
    status: comment.status,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    reply: comment.reply
      ? {
          text: comment.reply.text,
          by: comment.reply.by,
          createdAt: comment.reply.createdAt,
        }
      : null,
  }
}

function createAdminMiddleware() {
  return (req, res, next) => {
    const token = String(req.headers['x-admin-token'] || req.body?.token || req.query?.token || '').trim()
    if (!token || token !== String(config.SITE_ADMIN_TOKEN || '').trim()) {
      return res.status(401).json({ ok: false, error: 'غير مصرح' })
    }
    next()
  }
}

function startWebServer({ getRuntimeStats }) {
  const app = express()
  const adminOnly = createAdminMiddleware()
  const publicDir = path.join(__dirname, 'public')

  app.disable('x-powered-by')
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true }))
  app.use(express.static(publicDir, { extensions: ['html'] }))

  app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'fares-bot-site' })
  })

  app.get('/api/public/config', (req, res) => {
    res.json({
      ok: true,
      config: {
        siteTitle: config.SITE_TITLE,
        siteDescription: config.SITE_DESCRIPTION,
        websiteUrl: config.WEBSITE_URL,
        whatsappChannelUrl: config.WHATSAPP_CHANNEL_URL,
        developerWhatsappUrl: config.DEVELOPER_WHATSAPP_URL,
        developerWhatsappNumber: config.DEVELOPER_WHATSAPP,
        telegramBotUrl: config.TELEGRAM_BOT_URL,
      },
    })
  })

  app.get('/api/public/stats', (req, res) => {
    res.json({
      ok: true,
      stats: db.getStats(getRuntimeStats()),
    })
  })

  app.get('/api/public/comments', (req, res) => {
    const comments = db
      .listComments()
      .slice(0, Math.max(1, config.MAX_PUBLIC_COMMENTS))
      .map(formatApiComment)

    res.json({ ok: true, comments })
  })

  app.post('/api/public/comments', (req, res) => {
    const name = String(req.body?.name || '').trim()
    const contact = String(req.body?.contact || '').trim()
    const message = String(req.body?.message || '').trim()

    if (!name || name.length < 2) {
      return res.status(400).json({ ok: false, error: 'الاسم يجب أن يكون حرفين على الأقل.' })
    }
    if (!message || message.length < 5) {
      return res.status(400).json({ ok: false, error: 'التعليق أو الاستفسار قصير جداً.' })
    }
    if (message.length > 1200) {
      return res.status(400).json({ ok: false, error: 'التعليق طويل جداً.' })
    }

    const created = db.addComment({ name, contact, message })
    res.status(201).json({ ok: true, comment: formatApiComment(created) })
  })

  app.post('/api/admin/login', (req, res) => {
    const token = String(req.body?.token || '').trim()
    if (!token || token !== String(config.SITE_ADMIN_TOKEN || '').trim()) {
      return res.status(401).json({ ok: false, error: 'رمز الدخول غير صحيح.' })
    }
    res.json({ ok: true })
  })

  app.get('/api/admin/comments', adminOnly, (req, res) => {
    const comments = db.listComments({ includeHidden: true }).map(formatApiComment)
    res.json({ ok: true, comments })
  })

  app.post('/api/admin/comments/:id/reply', adminOnly, (req, res) => {
    try {
      const reply = String(req.body?.reply || '').trim()
      const by = String(req.body?.by || 'المطور').trim() || 'المطور'
      const updated = db.replyToComment(req.params.id, reply, by)
      res.json({ ok: true, comment: formatApiComment(updated) })
    } catch (e) {
      const status = e.message === 'comment_not_found' ? 404 : 400
      res.status(status).json({ ok: false, error: e.message === 'comment_not_found' ? 'التعليق غير موجود.' : 'الرد غير صالح.' })
    }
  })

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(publicDir, 'admin.html'))
  })

  app.use((req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'))
  })

  const server = app.listen(config.PORT, () => {
    console.log(`🌐 الموقع يعمل على المنفذ ${config.PORT}`)
    console.log(`🔗 رابط الموقع: ${config.WEBSITE_URL}`)
  })

  return { app, server }
}

module.exports = {
  startWebServer,
}
