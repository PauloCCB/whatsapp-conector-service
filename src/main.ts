import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  useMultiFileAuthState,
  WAMessage,
} from 'baileys';
import * as qrcode from 'qrcode';
import { Boom } from '@hapi/boom';
import { logger } from './baileys-conector/utils/logger';
import { FormattedMessage } from './baileys-conector/utils/message';
import MessageHandler from './baileys-conector/handlers/message';
import { getMessage, getMessageWithFallback } from './baileys-conector/utils/message';
import { messageQueue } from './baileys-conector/utils/message-queue';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}

const CONNECTION_TYPE = 'QR'; // "NUMBER" (se quiser usar o número para login)
const PHONE_NUMBER = '51982308431'; // +55 (68) 9200-0000 -> 556892000000 (formato para número)
const USE_LASTEST_VERSION = true;

export const initWASocket = async (): Promise<void> => {
  const { state, saveCreds } = await useMultiFileAuthState('auth');

  // Set para rastrear mensajes ya procesados y evitar duplicados
  const processedMessages = new Set<string>();

  const { version, isLatest } = await fetchLatestWaWebVersion({});

  if (USE_LASTEST_VERSION) {
    logger.info(
      `Version de whatsapp: ${version.join('.')} | ${
        isLatest ? 'Latest' : 'Outdated'
      }`,
    );
  }

  // @ts-ignore
  const sock = makeWASocket({
    auth: state,
    browser:
      // @ts-ignore
      CONNECTION_TYPE === 'NUMBER'
        ? Browsers.ubuntu('Chrome')
        : Browsers.appropriate('Desktop'),
    printQRInTerminal: false,
    version: USE_LASTEST_VERSION ? version : undefined,
    defaultQueryTimeoutMs: 0,
  });

  // @ts-ignore
  if (CONNECTION_TYPE === 'NUMBER' && !sock.authState.creds.registered) {
    try {
      const code = await sock.requestPairingCode(PHONE_NUMBER);
      logger.info(`Code: ${code}`);
    } catch (error) {
      logger.error('Error getting code.');
    }
  }
  //Conexión con WHATSAPP
  sock.ev.on(
    'connection.update',
    async ({ connection, lastDisconnect, qr }: any) => {
      logger.info(
        `Socket Connection Update: ${connection || ''} ${lastDisconnect || ''}`,
      );

      switch (connection) {
        case 'close':
          logger.error('Connection closed');
          // Remover o bot/deletar dados se necessário
          const shouldReconnect =
            (lastDisconnect.error as Boom)?.output?.statusCode !==
            DisconnectReason.loggedOut;

          if (shouldReconnect) {
            setTimeout(() => initWASocket(), 5000); // Atraso de 5 segundos antes de reconectar
          }
          break;
        case 'open':
          logger.info('Bot Connected');
          break;
      }

      // @ts-ignore
      if (qr !== undefined && CONNECTION_TYPE === 'QR') {
        qrcode
          .toString(qr, { small: true })
          .then((qrString) => {
            console.log(qrString);
          })
          .catch((err) => {
            logger.error('Error generating QR:', err);
          });
      }
    },
  );

  //! Mensajes entrantes y salientes
  sock.ev.on(
    'messages.upsert',
    ({ messages, type }: { messages: WAMessage[]; type: string }) => {
      for (let index = 0; index < messages.length; index++) {
        const message = messages[index];

        // Filtrar mensajes de grupos y estados
        const isGroup = message.key.remoteJid?.endsWith('@g.us');
        const isStatus = message.key.remoteJid === 'status@broadcast';

        if (isGroup || isStatus) continue;

        // Crear un identificador único para el mensaje
        const messageId = `${message.key.id}-${message.key.fromMe ? 'out' : 'in'}`;

        // Evitar procesar el mismo mensaje múltiples veces
        if (processedMessages.has(messageId)) {
          continue;
        }

        // Marcar el mensaje como procesado
        processedMessages.add(messageId);

        //* Mensajes salientes (que TÚ enviaste)
        if (message.key.fromMe) {
          logger.info(`[MENSAJE SALIENTE ]`);
          logger.info(`   SobreNombre: ${message.pushName}`);
          logger.info(`   Para: ${message.key.remoteJid}`);
          logger.info(`   Tipo: ${message.message?.imageMessage?.fileLength}`);
          logger.info(
            `   Contenido: ${message.message?.conversation || message.message?.extendedTextMessage?.text || message.mediaCiphertextSha256 || 'Sin contenido'}`,
          );
          logger.info(
            `   Timestamp: ${message.messageTimestamp ? new Date(Number(message.messageTimestamp) * 1000).toLocaleString() : 'Sin timestamp'}`,
          );
          logger.info(`   ID: ${message.key.id}`);
        }
        //* Mensajes entrantes (que recibes de otros)
        else if (type === 'notify') {
          // Solo procesar mensajes entrantes que NO sean tuyos
          logger.info(`[MENSAJE ENTRANTE ]`);
          logger.info(`   SobreNombre: ${message.pushName}`);
          logger.info(`   De: ${message.key.remoteJid}`);
          logger.info(`   Tipo: ${message.message?.imageMessage?.fileLength}`);
          logger.info(
            `   Contenido: ${message.message?.conversation || message.message?.extendedTextMessage?.text || message.mediaCiphertextSha256 || 'Sin contenido'}`,
          );
          logger.info(
            `   Timestamp: ${message.messageTimestamp ? new Date(Number(message.messageTimestamp) * 1000).toLocaleString() : 'Sin timestamp'}`,
          );
          logger.info(`   ID: ${message.key.id}`);

          // Procesar el mensaje con el handler usando la función mejorada
          // @ts-ignore
          const formattedMessage: FormattedMessage | null =
            getMessageWithFallback(message);
          
          if (formattedMessage !== null) {
            // Mostrar información adicional sobre la desencriptación
            if (!formattedMessage.isDecrypted) {
              logger.warn(`⚠️ Mensaje ${message.key.id} no se pudo desencriptar completamente`);
              
              // Agregar a la cola de reintentos con prioridad alta
              messageQueue.addToQueue(message, 'high');
            } else if (formattedMessage.retryCount) {
              logger.info(`🔄 Mensaje ${message.key.id} requirió ${formattedMessage.retryCount} reintentos`);
            }
            
            MessageHandler(sock, formattedMessage);
          } else {
            // Si no se pudo procesar, agregar a la cola
            logger.error(`❌ No se pudo procesar mensaje ${message.key.id}, agregando a cola de reintentos`);
            messageQueue.addToQueue(message, 'normal');
          }
        }
      }
    },
  );

  // Save credentials
  sock.ev.on('creds.update', saveCreds);

  // Limpiar mensajes procesados cada 5 minutos para evitar memoria infinita
  setInterval(
    () => {
      processedMessages.clear();
      logger.info('Limpieza de mensajes procesados completada');
    },
    5 * 60 * 1000,
  ); // 5 minutos

  // Limpiar cola de mensajes cada 10 minutos
  setInterval(
    () => {
      messageQueue.cleanup();
      const stats = messageQueue.getStats();
      logger.info(`📊 Estadísticas de cola: ${stats.queueLength} mensajes en cola, procesando: ${stats.processing}`);
    },
    10 * 60 * 1000,
  ); // 10 minutos
};
//bootstrap();
initWASocket();
