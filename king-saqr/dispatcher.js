// king-saqr/dispatcher.js
// موجّه موحّد لجميع أوامر King Saqr داخل بوت Fares Bot.
// كل النصوص والأسماء بالعربية الفصحى، مع إبقاء alias إنجليزي اختيارياً.

'use strict'

const fs = require('fs')
const path = require('path')

function tryLoad(rel) {
  try {
    // أولوية لتحميل الأوامر من king-saqr-lib إن وُجدت نظائر
    const fromRoot = path.join(__dirname, '..', rel)
    const fromKsqr = path.join(__dirname, '..', 'commands', path.basename(rel))
    if (fs.existsSync(fromKsqr)) return require(fromKsqr)
    return require(fromRoot)
  } catch { return null }
}

const H = {
  // —— عام ——
  ping: tryLoad('commands/ping'),
  alive: tryLoad('commands/alive'),
  owner: tryLoad('commands/owner'),
  joke: tryLoad('commands/joke'),
  quote: tryLoad('commands/quote'),
  fact: tryLoad('commands/fact'),
  weather: tryLoad('commands/weather'),
  news: tryLoad('commands/news'),
  lyrics: tryLoad('commands/lyrics'),
  tts: tryLoad('commands/tts'),
  translate: tryLoad('commands/translate'),
  ss: tryLoad('commands/ss'),
  url: tryLoad('commands/url'),
  groupinfo: tryLoad('commands/groupinfo'),
  staff: tryLoad('commands/staff'),
  topmembers: tryLoad('commands/topmembers'),
  misc: tryLoad('commands/misc'),
  // —— مسؤول ——
  tagall: tryLoad('commands/tagall'),
  tagnotadmin: tryLoad('commands/tagnotadmin'),
  hidetag: tryLoad('commands/hidetag'),
  kick: tryLoad('commands/kick'),
  ban: tryLoad('commands/ban'),
  unban: tryLoad('commands/unban'),
  mute: tryLoad('commands/mute'),
  unmute: tryLoad('commands/unmute'),
  warn: tryLoad('commands/warn'),
  warnings: tryLoad('commands/warnings'),
  del: tryLoad('commands/delete'),
  promote: tryLoad('commands/promote'),
  demote: tryLoad('commands/demote'),
  resetlink: tryLoad('commands/resetlink'),
  viewonce: tryLoad('commands/viewonce'),
  // —— ترفيه ——
  sticker: tryLoad('commands/sticker'),
  simage: tryLoad('commands/simage'),
  take: tryLoad('commands/take'),
  crop: tryLoad('commands/stickercrop'),
  removebg: tryLoad('commands/removebg'),
  remini: tryLoad('commands/remini'),
  blur: tryLoad('commands/img-blur'),
  meme: tryLoad('commands/meme'),
  ship: tryLoad('commands/ship'),
  character: tryLoad('commands/character'),
  wasted: tryLoad('commands/wasted'),
  simp: tryLoad('commands/simp'),
  stupid: tryLoad('commands/stupid'),
  flirt: tryLoad('commands/flirt'),
  compliment: tryLoad('commands/compliment'),
  insult: tryLoad('commands/insult'),
  pair: tryLoad('commands/pair'),
  dare: tryLoad('commands/dare'),
  truth: tryLoad('commands/truth'),
  hangman: tryLoad('commands/hangman'),
  tictactoe: tryLoad('commands/tictactoe'),
  trivia: tryLoad('commands/trivia'),
  goodnight: tryLoad('commands/goodnight'),
  shayari: tryLoad('commands/shayari'),
  roseday: tryLoad('commands/roseday'),
  attp: tryLoad('commands/attp'),
  pies: tryLoad('commands/pies'),
  anime: tryLoad('commands/anime'),
  igs: tryLoad('commands/igs'),
  imagine: tryLoad('commands/imagine'),
  sora: tryLoad('commands/sora'),
  ai: tryLoad('commands/ai'),
  eightball: tryLoad('commands/eightball'),
  emojimix: tryLoad('commands/emojimix'),
  // —— تنزيلات ——
  play: tryLoad('commands/play'),
  song: tryLoad('commands/song'),
  video: tryLoad('commands/video'),
  spotify: tryLoad('commands/spotify'),
  tiktok: tryLoad('commands/tiktok'),
  instagram: tryLoad('commands/instagram'),
  facebook: tryLoad('commands/facebook'),
  // —— المالك ——
  clearsession: tryLoad('commands/clearsession'),
  cleartmp: tryLoad('commands/cleartmp'),
  sudo: tryLoad('commands/sudo'),
  welcome: tryLoad('commands/welcome'),
  goodbye: tryLoad('commands/goodbye'),
  setpp: tryLoad('commands/setpp'),
  setgname: tryLoad('commands/groupmanage'),
  setgdesc: tryLoad('commands/groupmanage'),
  setgpp: tryLoad('commands/groupmanage'),
  pup: tryLoad('commands/setpp'),
  antibadword: tryLoad('commands/antibadword'),
  antitag: tryLoad('commands/antitag'),
  antilink: tryLoad('commands/antilink'),
  chatb: tryLoad('commands/chatbot'),
}

const RAW = {
  ping: ['بينغ', 'تأخير', 'ping', 'p'],
  alive: ['شغال', 'حي', 'alive', 'الحالة', 'متصل', 'status'],
  owner: ['المالك', 'المطور', 'owner', 'صاحب_البوت'],
  help: ['مساعدة', 'القائمة', 'الاوامر', 'الأوامر', 'help', 'menu', 'القائمه'],
  joke: ['نكتة', 'نكت', 'joke'],
  quote: ['اقتباس', 'قول', 'quote'],
  fact: ['معلومة', 'حقيقة', 'fact'],
  weather: ['طقس', 'الطقس', 'weather'],
  news: ['أخبار', 'اخبار', 'news'],
  lyrics: ['كلمات_اغنيه', 'كلمات', 'lyrics'],
  tts: ['قول_لي', 'tts', 'صوت'],
  translate: ['ترجم', 'ترجمة', 'tr', 'translate'],
  ss: ['سكرين', 'لقطة', 'ss', 'screenshot'],
  url: ['رابط_صوره', 'رابط', 'url'],
  groupinfo: ['معلومات_الجروب', 'معلومات_المجموعة', 'groupinfo', 'ginfo'],
  staff: ['الادمنز', 'مسؤولين', 'staff', 'admins'],
  topmembers: ['الأكثر_نشاطا', 'النشطين', 'topmembers', 'top'],
  tagall: ['تاج_الكل', 'تاق_الكل', 'منشن_الكل', 'tagall'],
  tagnotadmin: ['تاق_غير_الأدمن', 'تاق_للكل', 'تاقالكل', 'tagnotadmin'],
  hidetag: ['تاج_مخفي', 'تاق_مخفي', 'hidetag', 'تاغ_مخفي'],
  kick: ['طرد', 'طير', 'kick'],
  ban: ['حظر', 'باند', 'ban'],
  unban: ['رفع_حظر', 'الغاء_حظر', 'unban'],
  mute: ['كتم', 'كتم_الجروب', 'اسكات', 'mute'],
  unmute: ['فك_الكتم', 'الغاء_الكتم', 'unmute'],
  warn: ['تحذير', 'انذار', 'warn'],
  warnings: ['تحذيراتي', 'انذاراتي', 'warnings'],
  del: ['حذف', 'احذف', 'مسح', 'del', 'delete'],
  promote: ['ترقية', 'رفع_ادمن', 'promote', 'ادمن'],
  demote: ['ازالة_ادمن', 'تخفيض', 'demote'],
  resetlink: ['تحديث_الرابط', 'تحديث_اللنك', 'resetlink', 'ريسيت_اللينك'],
  viewonce: ['فتح_مره_واحده', 'عرض_مره', 'vv', 'viewonce'],
  sticker: ['ستيكر', 'ملصق', 'sticker', 's'],
  simage: ['ستيكر_صوره', 'simage'],
  take: ['اخذ', 'take'],
  crop: ['قص', 'crop'],
  removebg: ['حذف_خلفية', 'ازاله_الخلفية', 'removebg'],
  remini: ['تحسين_الصورة', 'remini'],
  blur: ['تمويه', 'ضبابي', 'blur'],
  meme: ['ميم', 'ميمز', 'meme'],
  ship: ['توفيق', 'ship'],
  character: ['شخصيه', 'شخصية', 'character'],
  wasted: ['ضيع', 'wasted'],
  simp: ['سيمب', 'simp'],
  stupid: ['غبي', 'stupid'],
  flirt: ['مغازلة', 'flirt'],
  compliment: ['مجامله', 'مدح', 'compliment'],
  insult: ['شتيمة', 'اهانه', 'اهانة', 'insult'],
  pair: ['توافق', 'pair'],
  dare: ['تحدي', 'dare'],
  truth: ['صراحة', 'truth'],
  hangman: ['شنق', 'hangman'],
  tictactoe: ['اكس_او', 'xo', 'tictactoe', 'ttt'],
  trivia: ['سؤال', 'trivia', 'triv'],
  goodnight: ['تصبح_على_خير', 'goodnight'],
  shayari: ['شعر', 'shayari'],
  roseday: ['يوم_الورده', 'وردة', 'roseday'],
  attp: ['نص_ملون', 'attp'],
  misc: ['عشوائي', 'misc', 'متفرقه'],
  pies: ['فطائر', 'pies', 'pies_صور'],
  anime: ['انمي', 'انيميشن', 'anime'],
  igs: ['ig_ستوري', 'igs'],
  imagine: ['تخيل', 'انشاء_صوره', 'imagine'],
  sora: ['سورا', 'sora'],
  ai: ['ذكاء', 'اسأل', 'ai', 'gpt', 'gemini'],
  eightball: ['كرة_الكريستال', 'eightball', '8ball'],
  emojimix: ['دمج_ايموجي', 'ايموجي', 'emojimix'],
  play: ['شغل', 'موسيقى', 'play'],
  song: ['اغنيه', 'اغنية', 'song'],
  video: ['فيديو', 'video', 'ytmp4'],
  spotify: ['سبوتيفاي', 'spotify'],
  tiktok: ['تيك_توك', 'تيك', 'tiktok', 'tt'],
  instagram: ['انستقرام', 'انستا', 'instagram', 'ig'],
  facebook: ['فيسبوك', 'facebook', 'fb'],
  clearsession: ['مسح_الجلسة', 'clearsession'],
  cleartmp: ['مسح_المؤقت', 'cleartmp'],
  sudo: ['سودو', 'صلاحيات', 'sudo'],
  welcome: ['ترحيب', 'welcome'],
  goodbye: ['وداع', 'goodbye'],
  setpp: ['صورتي', 'صورة_البوت', 'setpp'],
  pup: ['صورة_البوت', 'putpp'],
  setgname: ['اسم_الجروب', 'تغيير_الاسم', 'setgname'],
  setgdesc: ['وصف_الجروب', 'تغيير_الوصف', 'setgdesc'],
  setgpp: ['صورة_الجروب', 'تغيير_صورة_الجروب', 'setgpp'],
  antibadword: ['منع_الكلمات', 'مضاد_الشتائم', 'antibad'],
  antilink: ['منع_الروابط', 'مضاد_الروابط', 'antilink'],
  antitag: ['منع_التاق', 'مضاد_التاق', 'antitag'],
  chatb: ['دردشة', 'شات_ذكي', 'chatbot'],
}

const COMMAND_MAP = {}
for (const [canonical, aliases] of Object.entries(RAW)) {
  for (const alias of aliases) COMMAND_MAP[String(alias).toLowerCase().trim()] = canonical
}

function extractMessageText(message) {
  const m = message?.message
  if (!m || typeof m !== 'object') return ''
  for (const path of ['conversation', 'extendedTextMessage.text', 'imageMessage.caption', 'videoMessage.caption', 'documentMessage.caption']) {
    const segs = path.split('.')
    let cur = m
    for (const s of segs) { cur = cur?.[s]; if (cur == null) break }
    if (cur != null) return String(cur)
  }
  return ''
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseCommandLine(rawText, prefix = '.') {
  const text = String(rawText || '').trim()
  if (!text) return null
  // يقبل "." أو "!" أو "/" أو "#" أو بدون بادئة عربية "."
  const m = text.match(new RegExp(`^[${escapeRegExp('.')}${escapeRegExp('!')}${escapeRegExp('/')}${escapeRegExp('#')}]\\s*(\\S+)`))
  if (!m) return null
  return { cmd: String(m[1]).toLowerCase().trim(), rest: text.slice(m[0].length).trim() }
}

function getMentions(message) {
  const ctx = message?.message?.extendedTextMessage?.contextInfo
  return Array.isArray(ctx?.mentionedJid) ? ctx.mentionedJid : []
}

function parseDuration(text) {
  const m = String(text || '').match(/(\d+)/)
  return m ? Number(m[1]) : undefined
}

async function reply(sock, chatId, text, quoted) {
  try { await sock.sendMessage(chatId, { text }, { quoted }) } catch {}
}

async function runSafe(handler, args) {
  if (typeof handler !== 'function') return false
  try {
    const r = handler(...args)
    if (r && typeof r.then === 'function') await r
    return true
  } catch (e) {
    console.error('[king-saqr]', e?.message || e)
    return true
  }
}

async function dispatchMessage(sock, chatId, message, senderId, options = {}) {
  if (!message?.message) return false
  const rawText = extractMessageText(message)
  if (!rawText) return false
  const parsed = parseCommandLine(rawText, options.prefix || '.')
  if (!parsed) return false
  const canonical = COMMAND_MAP[parsed.cmd]
  if (!canonical) return false
  const args = parsed.rest
  const isGroup = String(chatId || '').endsWith('@g.us')
  const mentions = getMentions(message)
  const ctx = message.message?.extendedTextMessage?.contextInfo
  const quotedMsg = ctx?.quotedMessage

  try {
    switch (canonical) {
      case 'help': await renderArabicHelp(sock, chatId, message); return true
      case 'ping': if (!await runSafe(H.ping, [sock, chatId, message])) await reply(sock, chatId, '⚠️ أمر .بينغ غير مفعّل.', message); return true
      case 'alive': await runSafe(H.alive, [sock, chatId, message]); return true
      case 'owner': await runSafe(H.owner, [sock, chatId]); return true
      case 'joke': await runSafe(H.joke, [sock, chatId]); return true
      case 'quote': await runSafe(H.quote, [sock, chatId]); return true
      case 'fact': await runSafe(H.fact, [sock, chatId]); return true
      case 'weather': await runSafe(H.weather, [sock, chatId, message]); return true
      case 'news': await runSafe(H.news, [sock, chatId]); return true
      case 'lyrics': await runSafe(H.lyrics, [sock, chatId, message]); return true
      case 'tts': await runSafe(H.tts, [sock, chatId, message, args]); return true
      case 'translate': await runSafe(H.translate, [sock, chatId, message, args]); return true
      case 'ss': await runSafe(H.ss, [sock, chatId, message, args]); return true
      case 'url': await runSafe(H.url, [sock, chatId, message, args]); return true
      case 'groupinfo': if (!isGroup) { await reply(sock, chatId, '⚠️ هذا الأمر للمجموعات فقط.', message); return true } await runSafe(H.groupinfo, [sock, chatId, message]); return true
      case 'staff': if (!isGroup) return false; await runSafe(H.staff, [sock, chatId]); return true
      case 'topmembers': if (H.topmembers?.topMembers) await H.topmembers.topMembers(sock, chatId, isGroup); else await runSafe(H.topmembers, [sock, chatId, isGroup]); return true
      case 'tagall': if (!isGroup) return false; await runSafe(H.tagall, [sock, chatId, senderId, message]); return true
      case 'tagnotadmin': if (!isGroup) return false; await runSafe(H.tagnotadmin, [sock, chatId, senderId, message]); return true
      case 'hidetag': if (!isGroup) return false;
        await runSafe(H.hidetag, [sock, chatId, senderId, args, quotedMsg, message]); return true
      case 'kick': if (!isGroup) return false; await runSafe(H.kick, [sock, chatId, senderId, mentions, message]); return true
      case 'ban': await runSafe(H.ban, [sock, chatId, message]); return true
      case 'unban': await runSafe(H.unban, [sock, chatId, message]); return true
      case 'warn': if (!isGroup) return false; await runSafe(H.warn, [sock, chatId, senderId, mentions, message]); return true
      case 'warnings': await runSafe(H.warnings, [sock, chatId, mentions]); return true
      case 'mute': if (!isGroup) return false; await runSafe(H.mute, [sock, chatId, senderId, message, parseDuration(args)]); return true
      case 'unmute': if (!isGroup) return false; await runSafe(H.unmute, [sock, chatId]); return true
      case 'del': await runSafe(H.del, [sock, chatId, message, senderId]); return true
      case 'promote': if (!isGroup) return false; await runSafe(H.promote, [sock, chatId, mentions, message]); return true
      case 'demote': if (!isGroup) return false; await runSafe(H.demote, [sock, chatId, mentions, message]); return true
      case 'resetlink': if (!isGroup) return false; await runSafe(H.resetlink, [sock, chatId]); return true
      case 'viewonce': await runSafe(H.viewonce, [sock, chatId, message]); return true
      case 'sticker': await runSafe(H.sticker, [sock, chatId, message]); return true
      case 'simage': await runSafe(H.simage, [sock, chatId, message]); return true
      case 'take': await runSafe(H.take, [sock, chatId, message]); return true
      case 'crop': await runSafe(H.crop, [sock, chatId, message]); return true
      case 'removebg': await runSafe(H.removebg, [sock, chatId, message]); return true
      case 'remini': await runSafe(H.remini, [sock, chatId, message]); return true
      case 'blur': await runSafe(H.blur, [sock, chatId, message]); return true
      case 'meme': await runSafe(H.meme, [sock, chatId]); return true
      case 'ship': await runSafe(H.ship, [sock, chatId, message]); return true
      case 'character': await runSafe(H.character, [sock, chatId, message]); return true
      case 'wasted': await runSafe(H.wasted, [sock, chatId, message]); return true
      case 'simp': await runSafe(H.simp, [sock, chatId, message]); return true
      case 'stupid': await runSafe(H.stupid, [sock, chatId, message]); return true
      case 'flirt': await runSafe(H.flirt, [sock, chatId, message]); return true
      case 'compliment': await runSafe(H.compliment, [sock, chatId, message]); return true
      case 'insult': await runSafe(H.insult, [sock, chatId, message]); return true
      case 'pair': await runSafe(H.pair, [sock, chatId, message]); return true
      case 'dare': await runSafe(H.dare, [sock, chatId]); return true
      case 'truth': await runSafe(H.truth, [sock, chatId]); return true
      case 'hangman': if (!isGroup) return false; await runSafe(H.hangman, [sock, chatId, senderId, args, message]); return true
      case 'tictactoe': if (!isGroup) return false; await runSafe(H.tictactoe, [sock, chatId, senderId, args]); return true
      case 'trivia': if (!isGroup) return false; await runSafe(H.trivia, [sock, chatId, senderId, args]); return true
      case 'goodnight': await runSafe(H.goodnight, [sock, chatId]); return true
      case 'shayari': await runSafe(H.shayari, [sock, chatId]); return true
      case 'roseday': await runSafe(H.roseday, [sock, chatId]); return true
      case 'attp': await runSafe(H.attp, [sock, chatId, args]); return true
      case 'misc': await runSafe(H.misc, [sock, chatId, args]); return true
      case 'pies': await runSafe(H.pies, [sock, chatId, args]); return true
      case 'anime': await runSafe(H.anime, [sock, chatId, args]); return true
      case 'igs': await runSafe(H.igs, [sock, chatId, args]); return true
      case 'imagine': await runSafe(H.imagine, [sock, chatId, args]); return true
      case 'sora': await runSafe(H.sora, [sock, chatId, args]); return true
      case 'ai': await runSafe(H.ai, [sock, chatId, args]); return true
      case 'eightball': await runSafe(H.eightball, [sock, chatId, args]); return true
      case 'emojimix': await runSafe(H.emojimix, [sock, chatId, args]); return true
      case 'play': await runSafe(H.play, [sock, chatId, message]); return true
      case 'song': await runSafe(H.song, [sock, chatId, message]); return true
      case 'video': await runSafe(H.video, [sock, chatId, message]); return true
      case 'spotify': await runSafe(H.spotify, [sock, chatId, message]); return true
      case 'tiktok': await runSafe(H.tiktok, [sock, chatId, message]); return true
      case 'instagram': await runSafe(H.instagram, [sock, chatId, message]); return true
      case 'facebook': await runSafe(H.facebook, [sock, chatId, message]); return true
      case 'clearsession': await runSafe(H.clearsession, [sock, chatId, message]); return true
      case 'cleartmp': await runSafe(H.cleartmp, [sock, chatId, message]); return true
      case 'sudo': await runSafe(H.sudo, [sock, chatId, message, args]); return true
      case 'welcome': if (!isGroup) return false; await runSafe(H.welcome, [sock, chatId, message, args]); return true
      case 'goodbye': if (!isGroup) return false; await runSafe(H.goodbye, [sock, chatId, message, args]); return true
      case 'setpp': await runSafe(H.setpp, [sock, chatId, message]); return true
      case 'pup': await runSafe(H.pup, [sock, chatId, message]); return true
      case 'setgname': if (!isGroup) return false;
        if (H.setgname?.setGroupName) await H.setgname.setGroupName(sock, chatId, senderId, args, message); return true
      case 'setgdesc': if (!isGroup) return false;
        if (H.setgdesc?.setGroupDescription) await H.setgdesc.setGroupDescription(sock, chatId, senderId, args, message); return true
      case 'setgpp': if (!isGroup) return false;
        if (H.setgpp?.setGroupPhoto) await H.setgpp.setGroupPhoto(sock, chatId, senderId, message); return true
      case 'antibadword': if (!isGroup) return false; await runSafe(H.antibadword, [sock, chatId, message, args]); return true
      case 'antitag': if (!isGroup) return false; await runSafe(H.antitag, [sock, chatId, message, args]); return true
      case 'antilink': if (!isGroup) return false; await runSafe(H.antilink, [sock, chatId, message, args]); return true
      case 'chatb': if (!isGroup) return false; await runSafe(H.chatb, [sock, chatId, message, args]); return true
      default: return false
    }
  } catch (e) {
    console.error('[king-saqr dispatch]', e?.message || e)
    return true
  }
}

const ARABIC_HELP = [
  '╔═══════════════════════════════════════╗',
  '   🤖 *بوت الملك صقر — Fares Bot*',
  '   أوامر عربية شاملة + تفاعل تلقائي على الحالات',
  '╚═══════════════════════════════════════╝',
  '',
  '🟢 *الأوامر العامة*',
  '• .شغال — فحص اتصال البوت',
  '• .بينغ — قياس سرعة الاستجابة',
  '• .المالك — بطاقة اتصال المالك',
  '• .القائمة أو .مساعدة — عرض قائمة الأوامر',
  '• .نكتة | .اقتباس | .معلومة | .أخبار',
  '• .طقس <مدينة> | .كلمات_اغنيه',
  '• .قول_لي <نص> | .ترجم <نص> <رمز>',
  '• .لقطة <رابط> | .رابط_صوره <رابط>',
  '• .معلومات_الجروب | .الادمنز | .الأكثر_نشاطا',
  '',
  '🛡 *أوامر المسؤول (تحتاج البوت أدمن)*',
  '• .تاج_الكل | .تاق_غير_الأدمن | .تاج_مخفي',
  '• .طرد | .تحذير | .تحذيراتي',
  '• .حظر <منشن> | .رفع_حظر',
  '• .كتم | .فك_الكتم',
  '• .ترقية | .ازالة_ادمن',
  '• .حذف | .مسح_المؤقت',
  '• .منع_الروابط تشغيل/ايقاف | .منع_التاق | .منع_الكلمات',
  '• .تحديث_الرابط | .وصف_الجروب | .اسم_الجروب',
  '• .ترحيب تشغيل | .وداع تشغيل | .فتح_مره_واحده',
  '',
  '👑 *أوامر المالك (من رقم البوت فقط)*',
  '• .الاعدادات — عرض الإعدادات',
  '• .إيموجي <😆> — تغيير إيموجي التفاعل',
  '• .الوضع عام/خاص | .بادئة <.!#>',
  '• .ربط <رقم دولي> | .كلمة_السر <كلمة> | .لوحة',
  '• .رصيدي | .يومي | .المتجر | .شراء <كود> | .مزايا',
  '• .مسح_الجلسة',
  '',
  '🎨 *أوامر الوسائط والملصقات*',
  '• .ستيكر (رد على صورة/فيديو) | .اخذ | .قص',
  '• .ازاله_الخلفية | .تحسين_الصورة | .تمويه | .ميم',
  '• .شخصيه | .توفيق | .سيمب | .غبي | .مغازلة',
  '• .دمج_ايموجي 🧑‍🎨+🍔 | .كرة_الكريستال',
  '• .تخيل <وصف> | .اسأل <سؤال>',
  '• .اكس_او @user | .شنق',
  '',
  '📥 *أوامر التنزيل*',
  '• .شغل أو .اغنيه <اسم أو رابط>',
  '• .فيديو <اسم أو رابط> | .سبوتيفاي',
  '• .تيك_توك <رابط> | .انستقرام <رابط> | .فيسبوك <رابط>',
  '',
  '💡 كل الأوامر بالعربية تعمل، والأسماء الإنجليزية اختيارية.',
  '⚙️ البادئة الافتراضية: "."  — غيّرها بأمر .بادئة',
].join('\n')

async function renderArabicHelp(sock, chatId, message) {
  try {
    const imagePath = path.join(__dirname, '..', 'assets', 'bot_image.jpg')
    if (fs.existsSync(imagePath)) {
      const buf = fs.readFileSync(imagePath)
      try { await sock.sendMessage(chatId, { image: buf, caption: ARABIC_HELP }, { quoted: message }); return } catch {}
    }
    await sock.sendMessage(chatId, { text: ARABIC_HELP }, { quoted: message })
  } catch {}
}

module.exports = {
  dispatchMessage,
  COMMAND_MAP,
  ARABIC_HELP,
  renderArabicHelp,
  parseCommandLine,
  listCanonical: () => Object.keys(RAW),
  countAliases: () => Object.keys(COMMAND_MAP).length,
}
