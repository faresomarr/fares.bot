(function () {
  const STATE = {
    number: '',
    token: '',
    defaults: {},
    settings: {},
    wallet: null,
    reactions: null,
    fieldMeta: {},
    refreshTimer: null,
  }

  function qs(id) {
    return document.getElementById(id)
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  function setStatus(el, text, kind) {
    if (!el) return
    el.className = 'form-status ' + (kind || '')
    el.textContent = text || ''
  }

  function startWithNumber() {
    const path = window.location.pathname || ''
    const match = path.match(/\/panel\/([\d]+)/)
    return match ? match[1] : ''
  }

  function formatDate(value) {
    if (!value) return '—'
    try {
      return new Date(value).toLocaleString('ar')
    } catch {
      return '—'
    }
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('ar').format(Number(value || 0))
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

  function loadDefaults() {
    const defaults = {
      name: { label: 'اسم البوت', type: 'text', ph: 'Golden Queen Bot' },
      ownerNumber: { label: 'رقم التواصل', type: 'text', ph: '96777XXXXXXX' },
      ownername: { label: 'اسم المالك', type: 'text', ph: 'الاسم الكامل' },
      description: { label: 'المعلومات التعريفية', type: 'textarea', ph: 'Hi I am using Golden Queen Bot.' },
      from: { label: 'الموقع', type: 'text', ph: 'Yemen' },
      age: { label: 'العمر', type: 'text', ph: '24' },
      prefix: { label: 'البادئة', type: 'text', ph: '.' },
      footer2: { label: 'الفوتر', type: 'text', ph: 'Golden Queen Bot' },
      mode: { label: 'الوضع', type: 'select', options: ['public', 'private', 'self', 'group', 'inbox'] },
      antiBad: { label: 'مكافحة الكلمات السيئة', type: 'select', options: ['on', 'off'] },
      antiLink: { label: 'مكافحة الروابط', type: 'select', options: ['on', 'off'] },
      autoRecording: { label: 'تسجيل تلقائي', type: 'select', options: ['on', 'off'] },
      autoTyping: { label: 'كتابة تلقائية', type: 'select', options: ['on', 'off'] },
      alwaysOnline: { label: 'دائمًا أونلاين', type: 'select', options: ['on', 'off'] },
      autoStatusRead: { label: 'مشاهدة الحالة تلقائيًا', type: 'select', options: ['on', 'off'] },
      autoStatusReact: { label: 'التفاعل مع الحالة تلقائيًا', type: 'select', options: ['on', 'off'] },
      statusReactionNotice: { label: 'إظهار التفاعل لصاحب الرقم', type: 'select', options: ['on', 'off'] },
      keepDeletedStatus: { label: 'حفظ الحالة عند حذفها', type: 'select', options: ['on', 'off'] },
      ghostMode: { label: 'تفعيل الشبح', type: 'select', options: ['on', 'off'] },
      autoPrivateReact: { label: 'التفاعل التلقائي للخاص', type: 'select', options: ['on', 'off'] },
      autoRead: { label: 'قراءة تلقائية', type: 'select', options: ['on', 'off'] },
      autoBlock: { label: 'حظر تلقائي', type: 'select', options: ['on', 'off'] },
      autoReact: { label: 'تفاعل تلقائي', type: 'select', options: ['on', 'off'] },
      autoVoice: { label: 'صوت تلقائي', type: 'select', options: ['on', 'off'] },
      antiDelete: { label: 'مكافحة الحذف', type: 'select', options: ['on', 'off'] },
      sendDeleteTo: { label: 'إرسال المحذوف إلى', type: 'text', ph: 'owner' },
      antiCall: { label: 'مكافحة الاتصال', type: 'select', options: ['on', 'off'] },
      excludeCallNumbers: { label: 'أرقام مستثناة من منع الاتصالات', type: 'text', ph: '96777xx,96778yy' },
      statusMsgSend: { label: 'إرسال رسالة على الحالة', type: 'select', options: ['on', 'off'] },
      statusMsgType: { label: 'نوع رسالة الحالة', type: 'text', ph: 'default' },
      customMsg: { label: 'رسالة الحالة المخصصة', type: 'textarea', ph: 'رسالة ترحيب افتراضية' },
      menu: { label: 'صورة المنيو', type: 'text', ph: 'رابط صورة القائمة' },
      alive: { label: 'صورة alive', type: 'text', ph: 'رابط صورة alive' },
      owner: { label: 'صورة المالك', type: 'text', ph: 'رابط صورة المالك' },
      statusCustomReact: { label: 'رموز تعبيرية للحالة (10 كحد أقصى)', type: 'text', ph: '❤️,🔥,👍' },
      antiBug: { label: 'مكافحة البق', type: 'select', options: ['on', 'off'] },
      antiBot: { label: 'مكافحة البوت', type: 'select', options: ['on', 'off'] },
      antiBotAction: { label: 'إجراء مكافحة البوت', type: 'text', ph: 'delete' },
      gaGroupJid: { label: 'معرف الجروب', type: 'text', ph: '' },
      gaTimezone: { label: 'المنطقة الزمنية', type: 'text', ph: 'Asia/Aden' },
      gaCloseTime: { label: 'وقت الإغلاق', type: 'text', ph: '15:00' },
      gaOpenTime: { label: 'وقت الفتح', type: 'text', ph: '05:00' },
      customAutoReplies: { label: 'الردود التلقائية المخصصة', type: 'textarea', ph: 'كلمة:الرد\nhello:أهلا' },
      autoSave: { label: 'الحفظ التلقائي', type: 'select', options: ['on', 'off'] },
      language: { label: 'اللغة', type: 'text', ph: 'arabic' },
      antiViewOnce: { label: 'منع العرض لمرة واحدة', type: 'select', options: ['on', 'off'] },
      antiLinkList: { label: 'الروابط المحظورة', type: 'text', ph: 'wa.me,whatsapp.com' },
      antiBadWords: { label: 'الكلمات المحظورة', type: 'text', ph: 'كلمة1,كلمة2' },
      antiMention: { label: 'منع المنشن', type: 'select', options: ['on', 'off'] },
      antiEdit: { label: 'منع تعديل الرسائل', type: 'text', ph: 'inbox' },
      antiAction: { label: 'إجراء الحماية', type: 'text', ph: 'wern' },
      antiWarnCount: { label: 'عدد التحذيرات', type: 'text', ph: '3' },
      autoReactScope: { label: 'نطاق التفاعل التلقائي', type: 'text', ph: 'inbox' },
      aiReplyScope: { label: 'نطاق الرد الذكي', type: 'text', ph: 'inbox' },
      aliveMsg: { label: 'رسالة alive', type: 'textarea', ph: '❖ *Golden Queen Bot is alive*' },
      voiceFooter: { label: 'رابط الفوتر الصوتي', type: 'text', ph: 'https://...' },
    }
    STATE.fieldMeta = defaults
  }

  function createControl(key, meta, value) {
    let el
    if (meta.type === 'textarea') {
      el = document.createElement('textarea')
      el.rows = 3
    } else if (meta.type === 'select') {
      el = document.createElement('select')
      meta.options.forEach((opt) => {
        const opEl = document.createElement('option')
        opEl.value = opt
        opEl.textContent = opt
        if (opt === value) opEl.selected = true
        el.appendChild(opEl)
      })
    } else {
      el = document.createElement('input')
      el.type = meta.type === 'number' ? 'number' : 'text'
    }
    if (meta.type !== 'select') el.value = value || ''
    if (meta.ph) el.placeholder = meta.ph
    el.name = key
    el.dataset.settingKey = key
    return el
  }

  function buildSettingsGrid(settings, defaults) {
    const container = qs('panelSettingsGrid')
    container.innerHTML = ''
    const fragment = document.createDocumentFragment()
    const groupedLabels = {
      'معلومات أساسية': ['name', 'ownerNumber', 'ownername', 'description', 'from', 'age', 'prefix', 'footer2', 'mode', 'language'],
      'التفاعل والحالات': ['statusCustomReact', 'autoStatusRead', 'autoStatusReact', 'statusReactionNotice', 'keepDeletedStatus', 'autoRead', 'autoReact', 'autoPrivateReact', 'autoReactScope'],
      'الرد التلقائي والـ AI': ['customAutoReplies', 'aiReplyScope', 'aliveMsg', 'customMsg', 'statusMsgSend', 'statusMsgType', 'voiceFooter'],
      'الحماية والفلاتر': ['antiBad', 'antiBadWords', 'antiLink', 'antiLinkList', 'antiMention', 'antiViewOnce', 'antiBug', 'antiBot', 'antiBotAction', 'antiDelete', 'sendDeleteTo', 'antiEdit', 'antiAction', 'antiWarnCount'],
      الاتصالات: ['antiCall', 'excludeCallNumbers', 'autoBlock', 'autoVoice'],
      'الوجود والكتابة': ['autoTyping', 'autoRecording', 'alwaysOnline', 'ghostMode'],
      'الإدارة والمحتوى': ['menu', 'alive', 'owner', 'autoSave', 'gaGroupJid', 'gaTimezone', 'gaCloseTime', 'gaOpenTime'],
    }

    Object.entries(groupedLabels).forEach(([groupName, keys]) => {
      const block = document.createElement('div')
      block.className = 'panel-group'
      block.innerHTML = `<div class="panel-group-head"><strong>${escapeHtml(groupName)}</strong></div>`
      const grid = document.createElement('div')
      grid.className = 'panel-fields'
      keys.forEach((key) => {
        const meta = defaults[key]
        if (!meta) return
        const value = settings[key] != null ? String(settings[key]) : ''
        const fieldEl = document.createElement('label')
        fieldEl.className = 'panel-field'
        const label = document.createElement('span')
        label.textContent = meta.label
        fieldEl.appendChild(label)
        fieldEl.appendChild(createControl(key, meta, value))
        grid.appendChild(fieldEl)
      })
      block.appendChild(grid)
      fragment.appendChild(block)
    })

    container.appendChild(fragment)
  }

  function readFormSettings(form) {
    const out = {}
    form.querySelectorAll('[data-setting-key]').forEach((el) => {
      out[el.dataset.settingKey] = el.value
    })
    return out
  }

  async function api(path, options) {
    const opts = Object.assign({ method: 'GET', headers: {} }, options || {})
    if (typeof opts.body === 'object' && opts.body !== null && !(opts.body instanceof FormData)) {
      opts.body = JSON.stringify(opts.body)
      opts.headers['Content-Type'] = 'application/json'
    }
    if (STATE.token) opts.headers['x-panel-token'] = STATE.token
    const res = await fetch(path, opts)
    let data = {}
    try {
      data = await res.json()
    } catch {}
    return { ok: res.ok, status: res.status, data }
  }

  function showLogin() {
    qs('panelLoginCard').classList.remove('hidden')
    qs('panelMain').classList.add('hidden')
  }

  function showMain() {
    qs('panelLoginCard').classList.add('hidden')
    qs('panelMain').classList.remove('hidden')
  }

  function renderWallet(wallet) {
    STATE.wallet = wallet
    qs('walletBalance').textContent = formatNumber(wallet.balance)
    qs('walletClaimed').textContent = formatNumber(wallet.totalClaimed)
    qs('walletSpent').textContent = formatNumber(wallet.totalSpent)
    qs('walletNextClaim').textContent = wallet.canClaimDaily ? 'متاح الآن' : formatDuration(wallet.remainingMs)
    qs('panelTierBadge').textContent = wallet.tier || 'STANDARD'
    qs('panelTierBadge').className = 'tier-badge ' + ((wallet.tier || '').toLowerCase() === 'vip' ? 'vip' : '')

    const claimBtn = qs('claimDailyBtn')
    claimBtn.disabled = !wallet.canClaimDaily
    claimBtn.textContent = wallet.canClaimDaily ? `🎁 طلب ${wallet.dailyAmount} عملة اليوم` : '⏳ بانتظار الموعد التالي'

    const activeWrap = qs('activeFeaturesList')
    if (!wallet.activeFeatures || !wallet.activeFeatures.length) {
      activeWrap.className = 'feature-badges empty-state'
      activeWrap.textContent = 'لا توجد مزايا مفعلة حالياً.'
    } else {
      activeWrap.className = 'feature-badges'
      activeWrap.innerHTML = wallet.activeFeatures
        .map((item) => `<div class="feature-badge"><strong>${escapeHtml(item.title)}</strong><small>ينتهي: ${escapeHtml(formatDate(item.activeUntil))}</small></div>`)
        .join('')
    }

    const txWrap = qs('walletTransactions')
    if (!wallet.transactions || !wallet.transactions.length) {
      txWrap.className = 'wallet-transactions empty-state'
      txWrap.textContent = 'لا توجد عمليات حتى الآن.'
    } else {
      txWrap.className = 'wallet-transactions'
      txWrap.innerHTML = wallet.transactions
        .map((tx) => {
          const cls = Number(tx.amount || 0) >= 0 ? 'credit' : 'debit'
          return `
            <article class="wallet-tx ${cls}">
              <div>
                <strong>${escapeHtml(tx.description || tx.type)}</strong>
                <small>${escapeHtml(formatDate(tx.createdAt))}</small>
              </div>
              <span>${Number(tx.amount || 0) > 0 ? '+' : ''}${escapeHtml(formatNumber(tx.amount))}</span>
            </article>
          `
        })
        .join('')
    }
  }

  function renderStore(store) {
    const wrap = qs('storeOffers')
    wrap.innerHTML = (store || [])
      .map(
        (offer) => `
        <article class="store-card ${offer.active ? 'active' : ''}">
          <div class="store-card-head">
            <div>
              <span class="eyebrow">${escapeHtml(offer.key)}</span>
              <h3>${escapeHtml(offer.title)}</h3>
            </div>
            <strong>${escapeHtml(formatNumber(offer.price))} عملة</strong>
          </div>
          <p>${escapeHtml(offer.description)}</p>
          <div class="store-meta">
            <span>${offer.active ? 'مفعلة حتى ' + escapeHtml(formatDate(offer.activeUntil)) : 'غير مفعلة'}</span>
            <button class="btn ${offer.active ? 'btn-soft' : 'btn-secondary'} buy-offer-btn" data-offer-key="${escapeHtml(offer.key)}" type="button" ${offer.active ? 'disabled' : ''}>${offer.active ? 'مفعلة حالياً' : 'شراء الآن'}</button>
          </div>
        </article>
      `
      )
      .join('')

    document.querySelectorAll('.buy-offer-btn').forEach((btn) => {
      btn.addEventListener('click', () => buyOffer(btn.getAttribute('data-offer-key')))
    })
  }

  function renderReactions(reactions) {
    STATE.reactions = reactions
    const active = reactions.indicator === 'active'
    const hero = qs('reactionHero')
    hero.classList.toggle('active', active)
    qs('reactionDot').className = 'reaction-dot ' + (active ? 'active' : '')
    qs('reactionIndicatorText').textContent = active ? 'التفاعل ظاهر الآن باللون الأخضر' : 'لا يوجد تفاعل حديث'
    qs('reactionTotalCount').textContent = `${formatNumber(reactions.total || 0)} عملية`

    if (reactions.latestReaction) {
      qs('reactionLatestMeta').textContent = `آخر تفاعل: ${reactions.latestReaction.emoji} على حالة ${reactions.latestReaction.participantLabel || reactions.latestReaction.participantNumber} — ${formatDate(reactions.latestReaction.reactedAt)}`
    } else {
      qs('reactionLatestMeta').textContent = 'سيظهر هنا آخر تفاعل ناجح على الحالات.'
    }

    const wrap = qs('statusReactionsList')
    if (!reactions.logs || !reactions.logs.length) {
      wrap.className = 'reaction-log empty-state'
      wrap.textContent = 'لا توجد تفاعلات حالات مسجلة بعد.'
      return
    }

    wrap.className = 'reaction-log'
    wrap.innerHTML = reactions.logs
      .map(
        (item) => `
        <article class="reaction-item">
          <div class="reaction-item-emoji">${escapeHtml(item.emoji)}</div>
          <div class="reaction-item-body">
            <strong>تم التفاعل على حالة ${escapeHtml(item.participantLabel || item.participantNumber || 'غير معروف')}</strong>
            <small>وقت التنفيذ: ${escapeHtml(formatDate(item.reactedAt))}</small>
          </div>
          <span class="reaction-item-status">${escapeHtml(item.source || 'auto')}</span>
        </article>
      `
      )
      .join('')
  }

  async function loadSettings() {
    const { ok, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/settings')
    if (!ok || !data.ok) throw new Error(data?.error || 'انتهت الجلسة.')
    STATE.settings = data.settings || {}
    qs('panelHeaderNumber').textContent = data.number
    qs('panelStatusLabel').textContent = data.status || '—'
    qs('panelEmojiLabel').textContent = data.emoji || '❤️'
    buildSettingsGrid(STATE.settings, STATE.fieldMeta)
  }

  async function loadWalletAndStore() {
    const { ok, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/wallet')
    if (!ok || !data.ok) throw new Error(data?.error || 'تعذر تحميل المحفظة.')
    renderWallet(data.wallet)
    renderStore(data.store || [])
  }

  async function loadReactionLog() {
    const { ok, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/status-reactions')
    if (!ok || !data.ok) throw new Error(data?.error || 'تعذر تحميل سجل التفاعلات.')
    renderReactions(data.reactions)
  }

  async function loadAll() {
    try {
      await Promise.all([loadSettings(), loadWalletAndStore(), loadReactionLog()])
      showMain()
    } catch (e) {
      STATE.token = ''
      localStorage.removeItem('panel_token_' + STATE.number)
      showLogin()
      setStatus(qs('panelLoginStatus'), e.message || 'انتهت الجلسة، سجّل الدخول مجدداً.', 'error')
    }
  }

  async function handleLogin(ev) {
    ev.preventDefault()
    const number = qs('panelNumberInput').value.replace(/\D/g, '')
    const password = qs('panelPasswordInput').value
    const statusEl = qs('panelLoginStatus')
    setStatus(statusEl, 'جاري التحقق...')
    if (!number || !password) {
      setStatus(statusEl, 'أدخل الرقم وكلمة المرور.', 'error')
      return
    }
    try {
      const res = await fetch('/api/panel/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number, password }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setStatus(statusEl, data?.error || 'فشل تسجيل الدخول.', 'error')
        return
      }
      STATE.number = data.number
      STATE.token = data.token
      localStorage.setItem('panel_token_' + STATE.number, STATE.token)
      qs('panelPasswordInput').value = ''
      setStatus(statusEl, 'تم تسجيل الدخول بنجاح.', 'success')
      history.replaceState({}, '', '/panel/' + STATE.number)
      await loadAll()
    } catch (e) {
      setStatus(statusEl, e.message || 'فشل تسجيل الدخول.', 'error')
    }
  }

  async function handleSave() {
    const status = qs('panelSaveStatus')
    const settings = readFormSettings(qs('panelSettingsGrid'))
    setStatus(status, 'جاري الحفظ...')
    try {
      const { ok, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/settings', {
        method: 'POST',
        body: { settings },
      })
      if (!ok || !data.ok) {
        setStatus(status, data?.error || 'فشل الحفظ.', 'error')
        return
      }
      STATE.settings = data.settings || STATE.settings
      qs('panelEmojiLabel').textContent = STATE.settings.statusCustomReact || '❤️'
      setStatus(status, '✅ تم حفظ الإعدادات بنجاح.', 'success')
    } catch (e) {
      setStatus(status, e.message || 'فشل الحفظ.', 'error')
    }
  }

  async function handlePair(ev) {
    ev.preventDefault()
    const status = qs('panelPairStatus')
    const target = qs('panelPairNumber').value.replace(/\D/g, '')
    if (!target) {
      setStatus(status, 'أدخل الرقم الهدف.', 'error')
      return
    }
    setStatus(status, 'جاري إصدار كود الاقتران...')
    try {
      const { ok, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/pair', {
        method: 'POST',
        body: { number: target },
      })
      if (!ok || !data.ok) {
        setStatus(status, data?.error || 'فشل إصدار الكود.', 'error')
        qs('panelPairCodeBox').classList.add('hidden')
        return
      }
      qs('panelPairCode').textContent = data.code || '—'
      qs('panelPairCodeBox').classList.remove('hidden')
      setStatus(status, '✅ تم إصدار الكود بنجاح.', 'success')
    } catch (e) {
      setStatus(status, e.message || 'فشل إصدار الكود.', 'error')
    }
  }

  async function handlePasswordChange(ev) {
    ev.preventDefault()
    const status = qs('panelPasswordStatus')
    const current = qs('panelCurrentPassword').value
    const next = qs('panelNewPassword').value
    setStatus(status, 'جاري التحديث...')
    try {
      const { ok, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      })
      if (!ok || !data.ok) {
        setStatus(status, data?.error || 'فشل تحديث كلمة المرور.', 'error')
        return
      }
      qs('panelCurrentPassword').value = ''
      qs('panelNewPassword').value = ''
      setStatus(status, '✅ تم تحديث كلمة المرور.', 'success')
    } catch (e) {
      setStatus(status, e.message || 'فشل التحديث.', 'error')
    }
  }

  async function handleClaimDaily() {
    const status = qs('walletStatus')
    setStatus(status, 'جاري طلب المكافأة اليومية...')
    try {
      const { ok, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/claim-daily', {
        method: 'POST',
        body: {},
      })
      if (!ok || !data.ok) {
        const nextText = data?.remainingMs ? ` متاح بعد ${formatDuration(data.remainingMs)}.` : ''
        setStatus(status, (data?.error || 'تعذر استلام المكافأة اليومية.') + nextText, 'error')
        return
      }
      renderWallet(data.wallet)
      setStatus(status, `✅ تم إضافة ${data.amount} عملة إلى رصيدك.${data.notificationSent ? ' وتم إرسال إشعار خاص إلى الرقم.' : ''}`, 'success')
    } catch (e) {
      setStatus(status, e.message || 'تعذر استلام المكافأة اليومية.', 'error')
    }
  }

  async function buyOffer(offerKey) {
    const status = qs('storeStatus')
    setStatus(status, 'جاري تنفيذ عملية الشراء...')
    try {
      const { ok, data } = await api('/api/panel/' + encodeURIComponent(STATE.number) + '/store/buy', {
        method: 'POST',
        body: { offerKey },
      })
      if (!ok || !data.ok) {
        setStatus(status, data?.error || 'تعذر تنفيذ عملية الشراء.', 'error')
        return
      }
      renderWallet(data.result.wallet)
      renderStore((await api('/api/panel/' + encodeURIComponent(STATE.number) + '/wallet')).data.store || [])
      setStatus(status, `✅ تم شراء ${data.result.offer.title} بنجاح.${data.notificationSent ? ' وتم إرسال إشعار خاص.' : ''}`, 'success')
    } catch (e) {
      setStatus(status, e.message || 'تعذر تنفيذ عملية الشراء.', 'error')
    }
  }

  async function handleLogout() {
    if (STATE.token) {
      await api('/api/panel/logout', { method: 'POST', body: {} })
    }
    localStorage.removeItem('panel_token_' + STATE.number)
    STATE.token = ''
    STATE.number = ''
    history.replaceState({}, '', '/panel')
    qs('panelSettingsGrid').innerHTML = ''
    showLogin()
  }

  function installAutoRefresh() {
    if (STATE.refreshTimer) clearInterval(STATE.refreshTimer)
    STATE.refreshTimer = setInterval(() => {
      if (!STATE.number || !STATE.token) return
      loadWalletAndStore().catch(() => {})
      loadReactionLog().catch(() => {})
    }, 15000)
  }

  async function init() {
    loadDefaults()
    qs('panelLoginForm').addEventListener('submit', handleLogin)
    qs('panelSaveBtn').addEventListener('click', handleSave)
    qs('panelReloadBtn').addEventListener('click', () => loadAll())
    qs('panelPairForm').addEventListener('submit', handlePair)
    qs('panelPasswordForm').addEventListener('submit', handlePasswordChange)
    qs('panelLogoutBtn').addEventListener('click', handleLogout)
    qs('claimDailyBtn').addEventListener('click', handleClaimDaily)

    const numberInUrl = startWithNumber()
    if (numberInUrl) {
      qs('panelNumberInput').value = numberInUrl
      try {
        const res = await fetch('/api/panel/' + encodeURIComponent(numberInUrl) + '/default-password')
        const data = await res.json()
        if (data?.ok) {
          qs('panelPasswordHint').textContent = data.hasCustomPassword
            ? 'تم تعيين كلمة مرور مخصصة لهذا الرقم.'
            : 'كلمة المرور الافتراضية: ' + data.defaultPassword + ' (نفس الرقم).'
        }
      } catch {}
      const saved = localStorage.getItem('panel_token_' + numberInUrl)
      if (saved) {
        STATE.number = numberInUrl
        STATE.token = saved
        await loadAll()
      }
    }

    installAutoRefresh()
  }

  init().catch((e) => console.error('panel init error', e))
})()
