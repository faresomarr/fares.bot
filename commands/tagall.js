const isAdmin = require('../lib/isAdmin');  // Move isAdmin to helpers

async function tagAllCommand(sock, chatId, senderId, message) {
    try {
        const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);
        

        if (!isBotAdmin) {
            await sock.sendMessage(chatId, { text: 'يرجى جعل البوت مسؤولاً أولاً.' }, { quoted: message });
            return;
        }

        if (!isSenderAdmin) {
            await sock.sendMessage(chatId, { text: 'يمكن فقط لمسؤولي المجموعة استخدام الأمر .tagall.' }, { quoted: message });
            return;
        }

        // Get group metadata
        const groupMetadata = await sock.groupMetadata(chatId);
        const participants = groupMetadata.participants;

        if (!participants || participants.length === 0) {
            await sock.sendMessage(chatId, { text: 'لم يتم العثور على المشاركين في المجموعة.' });
            return;
        }

        // Create message with each member on a new line
        let messageText = '🔊 *أهلا بالجميع:*\n\n';
        participants.forEach(participant => {
            messageText += `@${participant.id.split('@')[0]}\n`; // Add \n for new line
        });

        // Send message with mentions
        await sock.sendMessage(chatId, {
            text: messageText,
            mentions: participants.map(p => p.id)
        });

    } catch (error) {
        console.error('خطأ في أمر tagall:', error);
        await sock.sendMessage(chatId, { text: 'فشل في وضع علامة على جميع الأعضاء.' });
    }
}

module.exports = tagAllCommand;  // Export directly
