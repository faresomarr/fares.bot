const express = require('express')
const path = require('path')
const config = require('./config')
const db = require('./db')
const whatsapp = require('./whatsapp')

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
        ownerPanelUrl: `${config.WEBSITE_URL.replace(/\/+$/, '')}/panel`,
        whatsappChannelUrl: config.WHATSAPP_CHANNEL_URL,
        developerWhatsappUrl: config.DEVELOPER_WHATSAPP_URL,
        developerWhatsappNumber: config.DEVELOPER_WHATSAPP,
        telegramBotUrl: config.TELEGRAM_BOT_URL,
        dailyCoinAmount: db.DAILY_COIN_AMOUNT,
        coinStore: db.COIN_STORE,
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
      res.status(status).json({
        ok: false,
        error: e.message === 'comment_not_found' ? 'التعليق غير موجود.' : 'الرد غير صالح.',
      })
    }
  })

  app.get('/admin', (req, res) => {
    res.sendFile(path.join(publicDir, 'admin.html'))
  })

  // ====================== لوحة إعدادات الرقم المربوط ======================

  app.get('/api/panel/:number/default-password', (req, res) => {
    const num = String(req.params.number || '').replace(/\D/g, '')
    if (!num) return res.status(400).json({ ok: false, error: 'رقم غير صالح.' })
    const record = db.getAllNumbers().find((n) => n.number === num)
    if (!record) return res.status(404).json({ ok: false, error: 'الرقم غير مربوط على هذا البوت.' })
    res.json({
      ok: true,
      defaultPassword: db.getDefaultPanelPasswordFor(num),
      hasCustomPassword: Boolean(record.panelPasswordHash),
    })
  })

  app.post('/api/panel/login', (req, res) => {
    try {
      const number = String(req.body?.number || '').replace(/\D/g, '')
      const password = String(req.body?.password || '').trim()
      if (!number || !password) {
        return res.status(400).json({ ok: false, error: 'الرقم وكلمة المرور مطلوبان.' })
      }
      const owner = db.numberOwner(number)
      if (!owner) return res.status(404).json({ ok: false, error: 'الرقم غير مربوط.' })
      const record = db.getNumber(owner, number)
      if (!record) return res.status(404).json({ ok: false, error: 'الرقم غير موجود.' })

      const ok = record.panelPasswordHash
        ? db.verifyPanelPassword(record.panelPasswordHash, password)
        : password === db.getDefaultPanelPasswordFor(number)
      if (!ok) return res.status(401).json({ ok: false, error: 'كلمة المرور غير صحيحة.' })

      const token = db.createPanelSession(owner, number)
      res.json({
        ok: true,
        token,
        userId: owner,
        number,
        settings: db.getPhoneSettings(owner, number),
        status: record.status,
        wallet: db.getWalletSummary(owner, number),
      })
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || 'خطأ غير متوقع.' })
    }
  })

  app.post('/api/panel/logout', (req, res) => {
    const token = String(req.body?.token || req.headers['x-panel-token'] || '').trim()
    db.destroyPanelSession(token)
    res.json({ ok: true })
  })

  function requirePanelSession(req, res, next) {
    const number = String(req.params.number || '').replace(/\D/g, '')
    const token = String(req.body?.token || req.headers['x-panel-token'] || req.query?.token || '').trim()
    const sess = db.getPanelSession(token)
    if (!sess || sess.number !== number) {
      return res.status(401).json({ ok: false, error: 'انتهت الجلسة. سجّل الدخول مجدداً.' })
    }
    req.panelSession = sess
    next()
  }

  app.get('/api/panel/:number/settings', requirePanelSession, (req, res) => {
    const sess = req.panelSession
    const settings = db.getPhoneSettings(sess.userId, sess.number)
    const record = db.getNumber(sess.userId, sess.number)
    res.json({
      ok: true,
      number: sess.number,
      userId: sess.userId,
      status: record?.status || 'unknown',
      emoji: record?.emoji || settings.statusCustomReact,
      settings,
      defaults: db.getDefaultPhoneSettings(),
    })
  })

  app.post('/api/panel/:number/settings', requirePanelSession, (req, res) => {
    try {
      const sess = req.panelSession
      const patch = req.body?.settings && typeof req.body.settings === 'object' ? req.body.settings : req.body || {}
      delete patch.token
      const next = db.setPhoneSettings(sess.userId, sess.number, patch)
      res.json({ ok: true, settings: next })
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || 'تعذر الحفظ.' })
    }
  })

  app.post('/api/panel/:number/password', requirePanelSession, (req, res) => {
    try {
      const sess = req.panelSession
      const current = String(req.body?.currentPassword || '').trim()
      const next = String(req.body?.newPassword || '').trim()
      if (!current || !next || next.length < 4) {
        return res.status(400).json({ ok: false, error: 'كلمة المرور الحالية والجديدة (4 أحرف على الأقل) مطلوبة.' })
      }
      const record = db.getNumber(sess.userId, sess.number)
      const ok = record.panelPasswordHash
        ? db.verifyPanelPassword(record.panelPasswordHash, current)
        : current === db.getDefaultPanelPasswordFor(sess.number)
      if (!ok) return res.status(401).json({ ok: false, error: 'كلمة المرور الحالية غير صحيحة.' })
      db.setPanelPassword(sess.userId, sess.number, next)
      res.json({ ok: true })
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || 'تعذر تحديث كلمة المرور.' })
    }
  })

  app.post('/api/panel/:number/pair', requirePanelSession, async (req, res) => {
    try {
      const sess = req.panelSession
      const target = String(req.body?.number || '').replace(/\D/g, '')
      if (!/^\d{8,15}$/.test(target)) {
        return res.status(400).json({ ok: false, error: 'صيغة الرقم الهدف غير صحيحة.' })
      }
      const ses = whatsapp.getSession(sess.userId, sess.number)
      if (!ses || !ses.sock) {
        return res.status(400).json({ ok: false, error: 'لا توجد جلسة نشطة لهذا الرقم.' })
      }
      const { formatted } = await ses.requestPairingCode(target)
      db.incrementMetric('totalPairingCodesIssued', 1)
      res.json({ ok: true, code: formatted })
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || 'تعذر إصدار كود الاقتران.' })
    }
  })

  app.get('/api/panel/:number/wallet', requirePanelSession, (req, res) => {
    try {
      const sess = req.panelSession
      res.json({
        ok: true,
        wallet: db.getWalletSummary(sess.userId, sess.number),
        store: db.getCoinStoreCatalog(sess.userId, sess.number),
      })
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || 'تعذر تحميل المحفظة.' })
    }
  })

  app.post('/api/panel/:number/claim-daily', requirePanelSession, async (req, res) => {
    try {
      const sess = req.panelSession
      const result = db.claimDailyCoins(sess.userId, sess.number)
      let notificationSent = false
      try {
        const text = [
          `🎁 تم الحصول على ${result.amount} عملة مجانية لرقمك ${sess.number}.`,
          `💰 الرصيد الحالي: ${result.wallet.balance} عملة.`,
          `🕒 الاستلام القادم بعد 24 ساعة من الآن.`,
        ].join('\n')
        notificationSent = Boolean(await whatsapp.sendLinkedNumberMessage(sess.userId, sess.number, text))
      } catch {}

      res.json({
        ok: true,
        amount: result.amount,
        wallet: result.wallet,
        notificationSent,
      })
    } catch (e) {
      if (e.message === 'daily_not_ready') {
        return res.status(429).json({
          ok: false,
          error: 'تم استلام المكافأة اليومية مسبقاً.',
          nextClaimAt: e.nextClaimAt || null,
          remainingMs: e.remainingMs || 0,
        })
      }
      res.status(400).json({ ok: false, error: e.message || 'تعذر استلام المكافأة اليومية.' })
    }
  })

  app.post('/api/panel/:number/store/buy', requirePanelSession, async (req, res) => {
    try {
      const sess = req.panelSession
      const offerKey = String(req.body?.offerKey || '').trim()
      const result = db.purchaseCoinFeature(sess.userId, sess.number, offerKey)
      let notificationSent = false
      try {
        const text = [
          `🛒 تم شراء الميزة: ${result.offer.title}`,
          `💰 الرصيد المتبقي: ${result.wallet.balance} عملة.`,
          `⏳ الميزة مفعلة الآن على رقمك المربوط.`,
        ].join('\n')
        notificationSent = Boolean(await whatsapp.sendLinkedNumberMessage(sess.userId, sess.number, text))
      } catch {}

      res.json({
        ok: true,
        result,
        notificationSent,
      })
    } catch (e) {
      const code = e.message === 'offer_not_found' ? 404 : e.message === 'insufficient_coins' ? 400 : 400
      res.status(code).json({
        ok: false,
        error:
          e.message === 'offer_not_found'
            ? 'الميزة المطلوبة غير موجودة.'
            : e.message === 'insufficient_coins'
              ? 'رصيد العملات غير كافٍ لإتمام الشراء.'
              : e.message || 'تعذر إتمام عملية الشراء.',
        balance: e.balance,
        price: e.price,
      })
    }
  })

  app.get('/api/panel/:number/status-reactions', requirePanelSession, (req, res) => {
    try {
      const sess = req.panelSession
      res.json({
        ok: true,
        reactions: db.getStatusReactionState(sess.userId, sess.number),
      })
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message || 'تعذر تحميل سجل التفاعلات.' })
    }
  })

  app.get('/panel', (req, res) => {
    res.sendFile(path.join(publicDir, 'panel.html'))
  })

  app.get('/panel/:number', (req, res) => {
    res.sendFile(path.join(publicDir, 'panel.html'))
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
