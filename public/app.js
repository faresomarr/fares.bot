// ============== لوحات الألوان الفخمة (كل ثانية تتغير بسلاسة) ==============
const COLOR_PALETTES = [
  { p: '#ff2d92', p2: '#6a5cff', p3: '#00e1ff', a: '#ffb547', name: 'pink-violet' },
  { p: '#00e1ff', p2: '#5b9dff', p3: '#9d4edd', a: '#ff7eb6', name: 'cyan-purple' },
  { p: '#9d4edd', p2: '#ff6b9d', p3: '#ffd166', a: '#06d6a0', name: 'vibrant' },
  { p: '#f72585', p2: '#7209b7', p3: '#3a0ca3', a: '#fcca46', name: 'neon-night' },
  { p: '#06d6a0', p2: '#118ab2', p3: '#06b6d4', a: '#ffd166', name: 'ocean' },
  { p: '#f8961e', p2: '#f9844a', p3: '#f3722c', a: '#90be6d', name: 'sunset' },
  { p: '#43e97b', p2: '#38f9d7', p3: '#667eea', a: '#f093fb', name: 'mint-sky' },
  { p: '#ee0979', p2: '#ff6a00', p3: '#ffd200', a: '#06d6a0', name: 'fire' },
  { p: '#7f00ff', p2: '#e100ff', p3: '#00c6ff', a: '#ffd700', name: 'royal' },
  { p: '#ff0844', p2: '#ffb199', p3: '#ffd1ff', a: '#ff6b9d', name: 'rose' },
  { p: '#1e3c72', p2: '#2a5298', p3: '#06d6a0', a: '#ffd166', name: 'deep-ocean' },
  { p: '#fc466b', p2: '#3f5efb', p3: '#ffb199', a: '#ffd166', name: 'candy' },
];

// ============== متغيرات الحالة ==============
const state = { config: null, stats: null };
let paletteIndex = 0;
let colorCycleTimer = null;

function qs(id) { return document.getElementById(id); }
function setText(id, value) { const el = qs(id); if (el) el.textContent = value; }
function setHref(id, value) { const el = qs(id); if (el && value) el.href = value; }

function formatNumber(value) { return new Intl.NumberFormat('ar').format(Number(value || 0)); }
function formatPercent(value) { return `${Number(value || 0).toFixed(0)}%`; }
function formatDate(value) {
  if (!value) return '—';
  try { return new Date(value).toLocaleString('ar'); }
  catch { return '—'; }
}
function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days} يوم / ${hours} ساعة`;
  if (hours > 0) return `${hours} ساعة / ${minutes} دقيقة`;
  return `${minutes} دقيقة`;
}
function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ============== تدوير الألوان كل ثانية ==============
function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyPalette(palette) {
  const root = document.documentElement;
  root.style.setProperty('--c-primary', palette.p);
  root.style.setProperty('--c-primary-2', palette.p2);
  root.style.setProperty('--c-primary-3', palette.p3);
  root.style.setProperty('--c-accent', palette.a);
  root.style.setProperty('--c-glow', hexToRgba(palette.p, 0.55));
  root.style.setProperty('--c-glow-2', hexToRgba(palette.p2, 0.45));
}

function startColorCycle() {
  // تطبيق اللوحة الأولى فوراً
  applyPalette(COLOR_PALETTES[0]);
  // التدوير كل ثانية
  if (colorCycleTimer) clearInterval(colorCycleTimer);
  colorCycleTimer = setInterval(() => {
    paletteIndex = (paletteIndex + 1) % COLOR_PALETTES.length;
    applyPalette(COLOR_PALETTES[paletteIndex]);
  }, 1000);
}

// ============== Reveal-on-scroll ==============
function setupReveal() {
  const items = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  items.forEach((el) => io.observe(el));
}

// ============== تكوين الموقع ==============
function renderConfig(config) {
  state.config = config;
  document.title = `${config.siteTitle} | منصة اقتران واتساب`;
  setText('siteTitle', config.siteTitle);
  setText('siteDescription', config.siteDescription);
  setText('developerNumberText', config.developerWhatsappNumber);

  const pairingUrl = config.telegramBotUrl || '#';
  const channelUrl = config.whatsappChannelUrl || '#';
  const developerUrl = config.developerWhatsappUrl || '#';
  const websiteUrl = config.websiteUrl || '#';
  const panelUrl = config.ownerPanelUrl || '/panel';

  ['navPairing', 'heroPairing', 'linkPairing'].forEach((id) => setHref(id, pairingUrl));
  ['navChannel', 'heroChannel', 'linkChannel', 'rightsChannel', 'footerChannel'].forEach((id) => setHref(id, channelUrl));
  ['navDeveloper', 'linkDeveloper', 'rightsDeveloper', 'footerDeveloper'].forEach((id) => setHref(id, developerUrl));
  ['navPanel', 'heroOwnerPortal', 'linkPanel'].forEach((id) => setHref(id, panelUrl));
  ['navAI', 'heroAI', 'heroAIQuick', 'footerAI'].forEach((id) => setHref(id, config.aiPageUrl || '/ai'));
  setHref('heroWebsite', websiteUrl);
  setHref('panelBotLink', pairingUrl);

  const hint = qs('portalLoginStatus');
  if (hint) hint.textContent = `المكافأة اليومية: ${config.dailyCoinAmount || 50} عملة لكل رقم مربوط.`;
}

function setProgress(idBar, idLabel, value) {
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  const bar = qs(idBar);
  if (bar) bar.style.width = `${safe}%`;
  setText(idLabel, formatPercent(safe));
}

function renderStats(stats) {
  state.stats = stats;
  setText('totalUsers', formatNumber(stats.totalUsers));
  setText('totalNumbers', formatNumber(stats.totalNumbers));
  setText('connectedNumbers', formatNumber(stats.connected));
  setText('pairingNumbers', formatNumber(stats.pairing));
  setText('joinedChannel', formatNumber(stats.channelJoined));
  setText('totalComments', formatNumber(stats.comments.totalComments));
  setText('totalStatusViews', formatNumber(stats.metrics.totalStatusViews));
  setText('totalStatusReactions', formatNumber(stats.metrics.totalStatusReactions));
  setText('activeSessionsCount', formatNumber(stats.runtime.activeSessions));
  setText('uptimeLabel', formatDuration(stats.runtime.uptimeMs));
  setText('lastUpdated', `آخر تحديث: ${formatDate(stats.lastUpdatedAt)}`);

  setProgress('connectedRateBar', 'connectedRateLabel', stats.connectedRate);
  setProgress('channelRateBar', 'channelRateLabel', stats.channelJoinRate);
  setProgress('replyRateBar', 'replyRateLabel', stats.health.repliedRate);
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
  status.textContent = 'تم إرسال تعليقك بنجاح وسيظهر مباشرة في الموقع.';
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

async function init() {
  // تشغيل دورة الألوان فوراً (لا تنتظر الشبكة)
  startColorCycle();
  setupReveal();

  await Promise.all([loadConfig(), loadStats(), loadComments()]);
  const form = qs('commentForm');
  if (form) form.addEventListener('submit', submitComment);
  const portalForm = qs('portalLoginForm');
  if (portalForm) portalForm.addEventListener('submit', submitPortalLogin);
  setInterval(() => {
    loadStats().catch(() => {});
    loadComments().catch(() => {});
  }, 15000);
}

init().catch((error) => { console.error(error); });
