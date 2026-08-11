const state = { config: null, stats: null };

function qs(id) { return document.getElementById(id); }
function setText(id, value) { const el = qs(id); if (el) el.textContent = value; }
function setHref(id, value) { const el = qs(id); if (el && value) el.href = value; }

function formatNumber(value) {
  return new Intl.NumberFormat('ar').format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return '—';
  try { return new Date(value).toLocaleString('ar'); }
  catch { return '—'; }
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderConfig(config) {
  state.config = config;
  document.title = `${config.siteTitle} | منصة ربط واتساب`;
  setText('siteTitle', config.siteTitle);
  setText('rightsTitle', config.siteTitle);
  setText('siteDescription', config.siteDescription);

  const channelUrl = config.whatsappChannelUrl || '#';
  const developerUrl = config.developerWhatsappUrl || '#';
  const panelUrl = config.ownerPanelUrl || '/panel';
  const aiUrl = config.aiPageUrl || '/ai';

  ['navChannel', 'heroChannel', 'footerChannel', 'rightsChannel'].forEach((id) => setHref(id, channelUrl));
  ['footerDeveloper', 'rightsDeveloper'].forEach((id) => setHref(id, developerUrl));
  ['navPanel', 'heroOwnerPortal', 'publicPairPanelLink'].forEach((id) => setHref(id, panelUrl));
  setHref('navAI', aiUrl);
  setHref('footerAI', aiUrl);

  const portalHint = qs('portalLoginStatus');
  if (portalHint) portalHint.textContent = `المكافأة اليومية: ${config.dailyCoinAmount || 50} عملة لكل رقم مربوط.`;
}

function renderStats(stats) {
  state.stats = stats;
  setText('totalUsers', formatNumber(stats.totalUsers));
  setText('totalNumbers', formatNumber(stats.totalNumbers));
  setText('connectedNumbers', formatNumber(stats.connected));
  setText('totalStatusReactions', formatNumber(stats.metrics.totalStatusReactions));
  setText('lastUpdated', `آخر تحديث: ${formatDate(stats.lastUpdatedAt)}`);
}

function renderComments(comments) {
  const feed = qs('commentsFeed');
  if (!feed) return;
  if (!comments.length) {
    feed.className = 'comments-feed empty-state';
    feed.textContent = 'لا توجد تعليقات حتى الآن.';
    return;
  }
  feed.className = 'comments-feed';
  feed.innerHTML = comments.map((comment) => {
    const contact = comment.contact ? `<div class="comment-contact">وسيلة التواصل: ${escapeHtml(comment.contact)}</div>` : '';
    const reply = comment.reply
      ? `<div class="comment-reply"><strong>رد المطور — ${escapeHtml(comment.reply.by || 'المطور')}</strong><div class="comment-message">${escapeHtml(comment.reply.text)}</div><div class="comment-meta">${escapeHtml(formatDate(comment.reply.createdAt))}</div></div>`
      : '';
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
    `;
  }).join('');
}

async function loadConfig() {
  const res = await fetch('/api/public/config');
  const data = await res.json();
  if (data.ok) renderConfig(data.config);
}

async function loadStats() {
  const res = await fetch('/api/public/stats');
  const data = await res.json();
  if (data.ok) renderStats(data.stats);
}

async function loadComments() {
  const res = await fetch('/api/public/comments');
  const data = await res.json();
  if (data.ok) renderComments(data.comments);
}

async function submitComment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = qs('formStatus');
  const formData = new FormData(form);
  status.className = 'form-status';
  status.textContent = 'جاري الإرسال...';

  const payload = {
    name: formData.get('name'),
    contact: formData.get('contact'),
    message: formData.get('message'),
  };

  const res = await fetch('/api/public/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (!res.ok || !data.ok) {
    status.className = 'form-status error';
    status.textContent = data.error || 'تعذر إرسال التعليق.';
    return;
  }

  form.reset();
  status.className = 'form-status success';
  status.textContent = 'تم إرسال تعليقك بنجاح.';
  await loadComments();
  await loadStats();
}

async function submitPortalLogin(event) {
  event.preventDefault();
  const status = qs('portalLoginStatus');
  const number = String(qs('portalNumber').value || '').replace(/\D/g, '');
  const password = String(qs('portalPassword').value || '');
  status.className = 'form-status';
  status.textContent = 'جاري التحقق...';

  const res = await fetch('/api/panel/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number, password }),
  });
  const data = await res.json();

  if (!res.ok || !data.ok) {
    status.className = 'form-status error';
    status.textContent = data.error || 'فشل تسجيل الدخول.';
    return;
  }

  localStorage.setItem('panel_token_' + data.number, data.token);
  status.className = 'form-status success';
  status.textContent = 'تم تسجيل الدخول، سيتم تحويلك الآن...';
  window.location.href = '/panel/' + data.number;
}

async function submitPublicPair(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = qs('publicPairStatus');
  const resultBox = qs('publicPairResult');
  const number = String(qs('publicPairNumber').value || '').replace(/\D/g, '');
  const accepted = qs('publicPairAccepted').checked;

  status.className = 'form-status';
  status.textContent = 'جاري تجهيز كود الاقتران...';
  resultBox.classList.add('hidden');

  const res = await fetch('/api/public/pairing-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number, accepted }),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.ok) {
    status.className = 'form-status error';
    status.textContent = data.error || 'تعذر إصدار الكود حالياً.';
    return;
  }

  status.className = 'form-status success';
  status.textContent = 'تم إنشاء الكود. أدخله في واتساب الآن.';
  setText('publicPairCode', data.code || '—');
  const link = qs('publicPairPanelLink');
  if (link && data.panelUrl) link.href = data.panelUrl;
  resultBox.classList.remove('hidden');
  form.reset();
  await loadStats();
}

async function init() {
  await Promise.all([loadConfig(), loadStats(), loadComments()]);
  const commentForm = qs('commentForm');
  if (commentForm) commentForm.addEventListener('submit', submitComment);
  const portalForm = qs('portalLoginForm');
  if (portalForm) portalForm.addEventListener('submit', submitPortalLogin);
  const publicPairForm = qs('publicPairForm');
  if (publicPairForm) publicPairForm.addEventListener('submit', submitPublicPair);
  setInterval(() => {
    loadStats().catch(() => {});
    loadComments().catch(() => {});
  }, 15000);
}

init().catch((error) => {
  console.error(error);
});
