import { proto, WAMessage } from "baileys";
import { logger } from "./logger";

export type FormattedMessage = {
  key: proto.IMessageKey;
  messageTimestamp: Number | Long | null;
  pushName: string | null;
  content: string | null;
  mediaCiphertextSha256: any | null;
  isDecrypted: boolean;
  retryCount?: number;
};

/**
 * Extrae el contenido del mensaje con múltiples intentos
 * @param message Mensaje de Baileys
 * @param retryCount Número de reintentos (por defecto 0)
 * @returns Contenido del mensaje o null si no se puede extraer
 */
const extractMessageContent = (message: WAMessage, retryCount: number = 0): string | null => {
  try {
    // Intentar extraer contenido de diferentes formas
    const content = 
      message.message?.conversation ||
      message.message?.extendedTextMessage?.text ||
      message.message?.imageMessage?.caption ||
      message.message?.videoMessage?.caption ||
      message.message?.documentMessage?.caption ||
      message.message?.locationMessage?.comment ||
      message.message?.contactMessage?.displayName ||
      message.message?.contactsArrayMessage?.displayName ||
      message.message?.reactionMessage?.text ||
      null;

    return content;
  } catch (error) {
    logger.error(`Error extrayendo contenido del mensaje (intento ${retryCount + 1}):`, error);
    return null;
  }
};

/**
 * Verifica si el mensaje tiene contenido válido
 * @param message Mensaje de Baileys
 * @returns true si el mensaje tiene contenido
 */
const hasValidContent = (message: WAMessage): boolean => {
  return !!(
    message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage ||
    message.message?.videoMessage ||
    message.message?.audioMessage ||
    message.message?.documentMessage ||
    message.message?.stickerMessage ||
    message.message?.locationMessage ||
    message.message?.contactMessage ||
    message.message?.contactsArrayMessage ||
    message.message?.reactionMessage ||
    message.message?.protocolMessage ||
    message.message?.senderKeyDistributionMessage ||
    message.message?.messageHistoryBundle
  );
};

/**
 * @param message Mensaje de Baileys
 * @param maxRetries Número máximo de reintentos (por defecto 3)
 * @returns Mensaje formateado con información de desencriptación
 */
export const getMessage = (message: WAMessage, maxRetries: number = 3): FormattedMessage | undefined => {
  let retryCount = 0;
  let content: string | null = null;
  let isDecrypted = false;

  // Intentar extraer contenido con reintentos
  while (retryCount <= maxRetries && !content) {
    content = extractMessageContent(message, retryCount);
    
    if (content) {
      isDecrypted = true;
      break;
    }
    
    retryCount++;
    
    // Esperar un poco antes del siguiente intento (backoff exponencial)
    if (retryCount <= maxRetries) {
      const delay = Math.pow(2, retryCount) * 100; // 200ms, 400ms, 800ms
      logger.info(`Reintentando extracción de mensaje ${message.key.id} (intento ${retryCount}/${maxRetries})`);
      // En un entorno real, aquí usarías setTimeout o una función async
    }
  }

  // Si no se pudo extraer contenido pero el mensaje tiene estructura válida
  if (!content && hasValidContent(message)) {
    logger.warn(`Mensaje ${message.key.id} tiene estructura válida pero no se pudo extraer contenido`);
    content = "Mensaje recibido (contenido no disponible)";
    isDecrypted = false;
  }

  try {
    return {
      key: message.key,
      messageTimestamp: message.messageTimestamp || null,
      pushName: message.pushName || null,
      content: content,
      mediaCiphertextSha256: message.message?.imageMessage || null,
      isDecrypted: isDecrypted,
      retryCount: retryCount > 0 ? retryCount : undefined,
    };
  } catch (error) {
    logger.error(`Error formateando mensaje ${message.key.id}:`, error);
    return undefined;
  }
};

/**
 * Función para procesar mensajes con fallas de desencriptación
 * @param message Mensaje de Baileys
 * @returns Mensaje formateado o null si no se puede procesar
 */
export const getMessageWithFallback = (message: WAMessage): FormattedMessage | null => {
  const formattedMessage = getMessage(message);
  
  if (!formattedMessage) {
    logger.error(`No se pudo formatear el mensaje ${message.key.id}`);
    return null;
  }

  // Si el mensaje no se pudo desencriptar completamente
  if (!formattedMessage.isDecrypted) {
    logger.warn(`Mensaje ${message.key.id} no se pudo desencriptar completamente`);
    
    // Intentar extraer información básica
    return {
      key: message.key,
      messageTimestamp: message.messageTimestamp,
      pushName: message.pushName,
      content: "Mensaje recibido (desencriptación fallida)",
      mediaCiphertextSha256: null,
      isDecrypted: false,
      retryCount: formattedMessage.retryCount,
    };
  }

  return formattedMessage;
};