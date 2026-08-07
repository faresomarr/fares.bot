require('dotenv').config()

module.exports = {
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || '',
  ADMIN_IDS: (process.env.ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number),
  ONLY_ADMINS: (process.env.ONLY_ADMINS || 'false').toString().toLowerCase() === 'true',
  DB_FILE: process.env.DB_FILE || './data/db.json',
  SESSIONS_DIR: process.env.SESSIONS_DIR || './sessions',

  /* التفاعل على الحالات بأقصى سرعة ممكنة مع تخفيف التأخير إلى أقل من ثانية */
  REACT_DELAY_MIN: Number(process.env.REACT_DELAY_MIN || 100),
  REACT_DELAY_MAX: Number(process.env.REACT_DELAY_MAX || 800),

  /* المطور (مالك البوت) */
  DEVELOPER_ID: 7231690686,
  DEVELOPER_WHATSAPP: '967773987296',

  /* قناة الواتساب الرسمية */
  WHATSAPP_CHANNEL_URL: 'https://whatsapp.com/channel/0029Vb8jjfWCRs1sVz0x1w3v',
  WHATSAPP_CHANNEL_INVITE: '0029Vb8jjfWCRs1sVz0x1w3v',
}
