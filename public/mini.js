// ============================================================
// لوحة تحكم The Mini Bot: تلوين متغيّر كل ثانية + تنقّل بين الأقسام + ربط مع الـ API
// ============================================================
(function () {
  const state = { themeIndex: 0 };

  // 12 لوحة ألوان فخمة تتبدّل كل ثانية تلقائياً
  const LUXURY_PALETTES = [
    { p: '#ff2d92', p2: '#6a5cff', p3: '#00e1ff', a: '#ffb547', glow: 'rgba(255,45,146,0.55)', glow2: 'rgba(106,92,255,0.45)', bg1: '#0a0418', bg2: '#1a0833' },
    { p: '#25d366', p2: '#0ea5e9', p3: '#8b5cf6', a: '#facc15', glow: 'rgba(37,211,102,0.55)', glow2: 'rgba(14,165,233,0.45)', bg1: '#021611', bg2: '#06231f' },
    { p: '#f43f5e', p2: '#a855f7', p3: '#22d3ee', a: '#ffd166', glow: 'rgba(244,63,94,0.55)', glow2: 'rgba(168,85,247,0.45)', bg1: '#1a0512', bg2: '#2a0a22' },
    { p: '#0ea5e9', p2: '#3b82f6', p3: '#14b8a6', a: '#fb7185', glow: 'rgba(14,165,233,0.55)', glow2: 'rgba(59,130,246,0.45)', bg1: '#031521', bg2: '#08293f' },
    { p: '#a855f7', p2: '#ec4899', p3: '#22c55e', a: '#fb923c', glow: 'rgba(168,85,247,0.55)', glow2: 'rgba(236,72,153,0.45)', bg1: '#150823', bg2: '#260c33' },
    { p: '#f59e0b', p2: '#ef4444', p3: '#6366f1', a: '#10b981', glow: 'rgba(245,158,11,0.55)', glow2: 'rgba(239,68,68,0.45)', bg1: '#1f1304', bg2: '#2e1c08' },
    { p: '#14b8a6', p2: '#0891b2', p3: '#84cc16', a: '#f97316', glow: 'rgba(20,184,166,0.55)', glow2: 'rgba(8,145,178,0.45)', bg1: '#021c19', bg2: '#062e2a' },
    { p: '#fbbf24', p2: '#f97316', p3: '#eab308', a: '#dc2626', glow: 'rgba(251,191,36,0.55)', glow2: 'rgba(249,115,22,0.45)', bg1: '#1c1605', bg2: '#322208' },
    { p: '#06b6d4', p2: '#0284c7', p3: '#22d3ee', a: '#84cc16', glow: 'rgba(6,182,212,0.55)', glow2: 'rgba(2,132,199,0.45)', bg1: '#03171c', bg2: '#062937' },
    { p: '#e11d48', p2: '#be185d', p3: '#7c3aed', a: '#f59e0b', glow: 'rgba(225,29,72,0.55)', glow2: 'rgba(190,24,93,0.45)', bg1: '#1f0712', bg2: '#33091d' },
    { p: '#84cc16', p2: '#22c55e', p3: '#10b981', a: '#06b6d4', glow: 'rgba(132,204,22,0.55)', glow2: 'rgba(34,197,94,0.45)', bg1: '#0c1505', bg2: '#152710' },
    { p: '#e879f9', p2: '#c084fc', p3: '#818cf8', a: '#38bdf8', glow: 'rgba(232,121,249,0.55)', glow2: 'rgba(192,132,252,0.45)', bg1: '#1a0a23', bg2: '#2e1144' },
  ];

  function applyPalette() {
    const pal = LUXURY_PALETTES[state.themeIndex % LUXURY_PALETTES.length];
    const root = document.documentElement.style;
    root.setProperty('--c-primary', pal.p);
    root.setProperty('--c-primary-2', pal.p2);
    root.setProperty('--c-primary-3', pal.p3);
    root.setProperty('--c-accent', pal.a);
    root.setProperty('--c-glow', pal.glow);
    root.setProperty('--c-glow-2', pal.glow2);
    root.setProperty('--bg-1', pal.bg1);
    root.setProperty('--bg-2', pal.bg2);
  }

  // تشغيل دورة الألوان كل ثانية بإيقاع فخم
  setInterval(() => {
    state.themeIndex = (state.themeIndex + 1) % LUXURY_PALETTES.length;
    applyPalette();
  }, 1000);
  applyPalette();

  // ============================================================
  // تنقّل بين الأقسام (SPA): كل قسم منفصل ويفتح وحده عند الضغط
  // ============================================================
  function showView(name) {
    const home = document.getElementById('homeView');
    const sections = document.querySelectorAll('.mini-view');
    if (name === 'home') {
      if (home) home.style.display = '';
      sections.forEach((s) => { s.style.display = 'none'; });
      try { history.replaceState(null, '', '#'); } catch (_) {}
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (home) home.style.display = 'none';
    sections.forEach((s) => { s.style.display = 'none'; });
    const target = document.getElementById('view-' + name);
    if (target) {
      target.style.display = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    try { history.replaceState(null, '', '#' + name); } catch (_) {}
  }

  window.showMiniView = showView;

  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-view]');
    if (opener) {
      e.preventDefault();
      showView(opener.getAttribute('data-view'));
      return;
    }
    const homeBtn = e.target.closest('[data-view-home]');
    if (homeBtn) {
      e.preventDefault();
      showView('home');
      return;
    }
    const langBtn = e.target.closest('[data-lang-btn]');
    if (langBtn) {
      e.preventDefault();
      const lang = langBtn.getAttribute('data-lang-btn');
      if (window.switchLanguage) window.switchLanguage(lang);
    }
  });

  // قراءة الـ hash عند التحميل
  window.addEventListener('hashchange', () => {
    const h = (location.hash || '').replace('#', '');
    if (!h) showView('home'); else showView(h);
  });

  // ============================================================
  // بيانات تجريبية ديناميكية (Active Bots) + الرسم البياني
  // ============================================================
  function generateBotsActivity(period) {
    const seed = { day: 7, week: 14, month: 30, year: 60, all: 90 }[period] || 30;
    const arr = [];
    let v = 2400;
    for (let i = 0; i < seed; i++) {
      v += Math.round((Math.sin(i * 0.6) + Math.cos(i * 0.4)) * 30) - 6 + Math.random() * 50;
      if (v < 2300) v = 2300 + Math.random() * 80;
      if (v > 2650) v = 2650 - Math.random() * 80;
      arr.push(Math.round(v));
    }
    return arr;
  }

  function drawChart(period) {
    const canvas = document.getElementById('botsChart');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 540;
    const H = 240;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const data = generateBotsActivity(period);
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = Math.max(1, max - min);
    const baseY = H - 30;
    const stepX = (W - 40) / Math.max(1, data.length - 1);

    // شبكة خفيفة
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = 20 + (baseY - 20) * (i / 4);
      ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(W - 20, y); ctx.stroke();
    }

    // الخط المتدرّج
    const gradient = ctx.createLinearGradient(0, 0, W, 0);
    gradient.addColorStop(0, getCssVar('--c-primary'));
    gradient.addColorStop(0.5, getCssVar('--c-primary-2'));
    gradient.addColorStop(1, getCssVar('--c-primary-3'));

    ctx.beginPath();
    data.forEach((v, i) => {
      const x = 20 + stepX * i;
      const y = baseY - ((v - min) / range) * (baseY - 30);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2.4;
    ctx.shadowColor = getCssVar('--c-glow');
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // تعبئة تحت الخط
    ctx.lineTo(20 + stepX * (data.length - 1), baseY);
    ctx.lineTo(20, baseY);
    ctx.closePath();
    const fillGrad = ctx.createLinearGradient(0, baseY, 0, 0);
    fillGrad.addColorStop(0, 'rgba(255,255,255,0)');
    fillGrad.addColorStop(1, getCssVar('--c-glow'));
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // آخر قيمة
    const last = data[data.length - 1];
    const lastX = 20 + stepX * (data.length - 1);
    const lastY = baseY - ((last - min) / range) * (baseY - 30);
    ctx.fillStyle = getCssVar('--c-accent');
    ctx.beginPath(); ctx.arc(lastX, lastY, 5, 0, Math.PI * 2); ctx.fill();
  }

  function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#fff';
  }

  // مبدّل الفترات الزمنية للرسم البياني
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-period]');
    if (!tab) return;
    document.querySelectorAll('[data-period]').forEach((b) => b.classList.toggle('active', b === tab));
    drawChart(tab.getAttribute('data-period'));
  });

  // تحديث قيمة "نشطة الآن" بشكل خفيف مع كل تغيير لون
  setInterval(() => {
    const el = document.getElementById('activeNow');
    if (!el) return;
    const n = 2400 + Math.round(Math.sin(Date.now() / 1000) * 60) + Math.floor(Math.random() * 80);
    el.textContent = new Intl.NumberFormat('en').format(n);
  }, 1500);

  // رسم أوّلي
  setTimeout(() => drawChart('day'), 50);

  // إعادة الرسم عند تغيّر حجم النافذة
  let curPeriod = 'day';
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-period]');
    if (t) curPeriod = t.getAttribute('data-period');
  });
  window.addEventListener('resize', () => drawChart(curPeriod));
})();
