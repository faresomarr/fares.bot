const state = {
  config: null,
  stats: null,
}

function qs(id) {
  return document.getElementById(id)
}

function setText(id, value) {
  const el = qs(id)
  if (el) el.textContent = value
}

function setHref(id, value) {
  const el = qs(id)
  if (el && value) el.href = value
}

function formatNumber(value) {
  return new Intl.NumberFormat('ar').format(Number(value || 0))
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(0)}%`
}

function formatDate(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString('ar')
  } catch {
    return '—'
  }
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (days > 0) return `${days} يوم / ${hours} ساعة`
  if (hours > 0) return `${hours} ساعة / ${minutes} دقيقة`
  return `${minutes} دقيقة`
}

function renderConfig(config) {
  state.config = config
  document.title = `${config.siteTitle} | منصة اقتران واتساب`
  setText('siteTitle', config.siteTitle)
  setText('siteDescription', config.siteDescription)
  setText('developerNumberText', config.developerWhatsappNumber)

  const pairingUrl = config.pairingBotUrl || config.telegramBotUrl || '#'
  const channelUrl = config.whatsappChannelUrl || '#'
  const developerUrl = config.developerWhatsappUrl || '#'
  const websiteUrl = config.websiteUrl || '#'

  ;['navPairing', 'heroPairing', 'linkPairing'].forEach((id) => setHref(id, pairingUrl))
  ;['navChannel', 'heroChannel', 'linkChannel', 'rightsChannel', 'footerChannel'].forEach((id) => setHref(id, channelUrl))
  ;['navDeveloper', 'heroDeveloper', 'linkDeveloper', 'rightsDeveloper', 'footerDeveloper'].forEach((id) => setHref(id, developerUrl))
  setHref('heroWebsite', websiteUrl)
}

function setProgress(idBar, idLabel, value) {
  const safe = Math.max(0, Math.min(100, Number(value || 0)))
  const bar = qs(idBar)
  if (bar) bar.style.width = `${safe}%`
  setText(idLabel, formatPercent(safe))
}

function renderStats(stats) {
  state.stats = stats
  setText('totalUsers', formatNumber(stats.totalUsers))
  setText('totalNumbers', formatNumber(stats.totalNumbers))
  setText('connectedNumbers', formatNumber(stats.connected))
  setText('pairingNumbers', formatNumber(stats.pairing))
  setText('joinedChannel', formatNumber(stats.channelJoined))
  setText('totalComments', formatNumber(stats.comments.totalComments))
  setText('totalStatusViews', formatNumber(stats.metrics.totalStatusViews))
  setText('totalStatusReactions', formatNumber(stats.metrics.totalStatusReactions))
  setText('connectedCount', formatNumber(stats.connected))
  setText('activeSessionsCount', formatNumber(stats.runtime.activeSessions))
  setText('pendingCommentsCount', formatNumber(stats.comments.pendingReplies))
  setText('uptimeLabel', formatDuration(stats.runtime.uptimeMs))
  setText('lastUpdated', `آخر تحديث: ${formatDate(stats.lastUpdatedAt)}`)

  setProgress('connectedRateBar', 'connectedRateLabel', stats.connectedRate)
  setProgress('channelRateBar', 'channelRateLabel', stats.channelJoinRate)
  setProgress('replyRateBar', 'replyRateLabel', stats.health.repliedRate)
}

function renderComments(comments) {
  const feed = qs('commentsFeed')
  if (!feed) return
  if (!comments.length) {
    feed.className = 'comments-feed empty-state'
    feed.textContent = 'لا توجد تعليقات حتى الآن.'
    return
  }

  feed.className = 'comments-feed'
  feed.innerHTML = comments
    .map((comment) => {
      const contact = comment.contact ? `<div class="comment-contact">وسيلة التواصل: ${escapeHtml(comment.contact)}</div>` : ''
      const reply = comment.reply
        ? `<div class="comment-reply"><strong>رد المطور — ${escapeHtml(comment.reply.by || 'المطور')}</strong><div class="comment-message">${escapeHtml(comment.reply.text)}</div><div class="comment-meta">${escapeHtml(formatDate(comment.reply.createdAt))}</div></div>`
        : ''

      return `
        <article class="comment-item">
          <div class="comment-top">
            <div>
              <div class="comment-name">${escapeHtml(comment.name)}</div>
              <div class="comment-meta">${escapeHtml(formatDate(comment.createdAt))}</div>
            </div>
            <span class="comment-meta">${comment.reply ? 'تم الرد' : 'بانتظار الرد'}</span>
          </div>
          ${contact}
          <div class="comment-message">${escapeHtml(comment.message)}</div>
          ${reply}
        </article>
      `
    })
    .join('')
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

async function loadConfig() {
  const res = await fetch('/api/public/config')
  const data = await res.json()
  if (data.ok) renderConfig(data.config)
}

async function loadStats() {
  const res = await fetch('/api/public/stats')
  const data = await res.json()
  if (data.ok) renderStats(data.stats)
}

async function loadComments() {
  const res = await fetch('/api/public/comments')
  const data = await res.json()
  if (data.ok) renderComments(data.comments)
}

async function submitComment(event) {
  event.preventDefault()
  const form = event.currentTarget
  const status = qs('formStatus')
  const formData = new FormData(form)
  status.className = 'form-status'
  status.textContent = 'جاري الإرسال...'

  const payload = {
    name: formData.get('name'),
    contact: formData.get('contact'),
    message: formData.get('message'),
  }

  const res = await fetch('/api/public/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json()

  if (!res.ok || !data.ok) {
    status.className = 'form-status error'
    status.textContent = data.error || 'تعذر إرسال التعليق.'
    return
  }

  form.reset()
  status.className = 'form-status success'
  status.textContent = 'تم إرسال تعليقك بنجاح وسيظهر مباشرة في الموقع.'
  await loadComments()
  await loadStats()
}

async function init() {
  await Promise.all([loadConfig(), loadStats(), loadComments()])
  const form = qs('commentForm')
  if (form) form.addEventListener('submit', submitComment)
  setInterval(() => {
    loadStats().catch(() => {})
    loadComments().catch(() => {})
  }, 15000)
}

init().catch((error) => {
  console.error(error)
})
