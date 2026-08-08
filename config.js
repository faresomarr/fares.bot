require('dotenv').config()

function normalizeBaseUrl(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  return value.replace(/\/+$/, '')
}

const port = Number(process.env.PORT || 3000)
const websiteUrl =
  normalizeBaseUrl(process.env.WEBSITE_URL) ||
  normalizeBaseUrl(process.env.RENDER_EXTERNAL_URL) ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${String(process.env.RAILWAY_PUBLIC_DOMAIN).trim()}` : '') ||
  `http://localhost:${port}`

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

  REACT_DELAY_MIN: Number(process.env.REACT_DELAY_MIN || 100),
  REACT_DELAY_MAX: Number(process.env.REACT_DELAY_MAX || 800),

  PORT: port,
  WEBSITE_URL: websiteUrl,
  SITE_TITLE: process.env.SITE_TITLE || 'Fares Bot',
  SITE_DESCRIPTION:
    process.env.SITE_DESCRIPTION ||
    'منصة رسمية لعرض مميزات البوت، الإحصائيات المباشرة، واستقبال تعليقات واستفسارات المستخدمين مع رد المطور.',
  SITE_ADMIN_TOKEN: process.env.SITE_ADMIN_TOKEN || 'change-this-admin-token',
  MAX_PUBLIC_COMMENTS: Number(process.env.MAX_PUBLIC_COMMENTS || 50),

  DEVELOPER_ID: Number(process.env.DEVELOPER_ID || 7231690686),
  DEVELOPER_WHATSAPP: String(process.env.DEVELOPER_WHATSAPP || '967773987296').replace(/\D/g, ''),
  DEVELOPER_WHATSAPP_URL:
    process.env.DEVELOPER_WHATSAPP_URL ||
    `https://wa.me/${String(process.env.DEVELOPER_WHATSAPP || '967773987296').replace(/\D/g, '')}`,

  WHATSAPP_CHANNEL_URL:
    process.env.WHATSAPP_CHANNEL_URL || 'https://whatsapp.com/channel/0029Vb8jjfWCRs1sVz0x1w3v',
  WHATSAPP_CHANNEL_INVITE: process.env.WHATSAPP_CHANNEL_INVITE || '0029Vb8jjfWCRs1sVz0x1w3v',

  TELEGRAM_BOT_URL: process.env.TELEGRAM_BOT_URL || 'https://t.me/Faresw_bob',
}
