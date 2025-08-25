import { WASocket } from "baileys";
import { FormattedMessage } from "../utils/message";
import { logger } from "../utils/logger";

const MessageHandler = async (bot: WASocket, message: FormattedMessage) => {
    // 📱 Mostrar información del mensaje entrante
    logger.info(`[MENSAJE ENTRANTE]`);
    logger.info(`   De: ${message.pushName || 'Sin nombre'} (${message.key.remoteJid})`);
    logger.info(`   Contenido: ${message.content || 'Sin contenido'}`);
    logger.info(`   Timestamp: ${message.messageTimestamp ? new Date(Number(message.messageTimestamp) * 1000).toLocaleString() : 'Sin timestamp'}`);
    logger.info(`   ID: ${message.key.id}`);

}

export default MessageHandler;