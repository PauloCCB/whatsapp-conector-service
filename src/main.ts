import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import makeWASocket, { Browsers, DisconnectReason, fetchLatestWaWebVersion, useMultiFileAuthState, WAMessage } from 'baileys';
import * as qrcode from 'qrcode';
import { Boom } from '@hapi/boom';
import { logger } from './baileys-conector/utils/logger';
import { FormattedMessage } from './baileys-conector/utils/message';
import MessageHandler from './baileys-conector/handlers/message';
import { getMessage } from './baileys-conector/utils/message';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}

const CONNECTION_TYPE = "QR"; // "NUMBER" (se quiser usar o número para login)
const PHONE_NUMBER = "51982308431"; // +55 (68) 9200-0000 -> 556892000000 (formato para número)
const USE_LASTEST_VERSION = true;

export const initWASocket = async (): Promise<void> => {
  const { state, saveCreds } = await useMultiFileAuthState("auth");

  const { version, isLatest } = await fetchLatestWaWebVersion({});

  if (USE_LASTEST_VERSION) {
    logger.info(
      `Version de whatsapp: ${version.join(".")} | ${
        isLatest ? "Latest" : "Outdated"
      }`  
    );
  }

  // @ts-ignore
  const sock = makeWASocket({
    auth: state,
    browser:
      // @ts-ignore
      CONNECTION_TYPE === "NUMBER"
        ? Browsers.ubuntu("Chrome")
        : Browsers.appropriate("Desktop"),
    printQRInTerminal: false,
    version: USE_LASTEST_VERSION ? version : undefined,
    defaultQueryTimeoutMs: 0,
  });

  // @ts-ignore
  if (CONNECTION_TYPE === "NUMBER" && !sock.authState.creds.registered) {
    try {
      const code = await sock.requestPairingCode(PHONE_NUMBER);
      logger.info(`Code: ${code}`);
    } catch (error) {
      logger.error("Error getting code.");
    }
  }

  sock.ev.on(
    "connection.update",
    async ({ connection, lastDisconnect, qr }: any) => {
      logger.info(
        `Socket Connection Update: ${connection || ""} ${lastDisconnect || ""}`
      );

      switch (connection) {
        case "close":
          logger.error("Connection closed");
          // Remover o bot/deletar dados se necessário
          const shouldReconnect =
            (lastDisconnect.error as Boom)?.output?.statusCode !==
            DisconnectReason.loggedOut;

            if (shouldReconnect) {
              setTimeout(() => initWASocket(), 5000);  // Atraso de 5 segundos antes de reconectar
            }
          break;
        case "open":
          logger.info("Bot Connected");
          break;
      }

      // @ts-ignore
      if (qr !== undefined && CONNECTION_TYPE === "QR") {
        qrcode.toString(qr, { small: true }).then((qrString) => {
          console.log(qrString);
        }).catch((err) => {
          logger.error('Error generating QR:', err);
        });
      }
    }
  );

  sock.ev.on("messages.upsert", ({ messages }: { messages: WAMessage[] }) => {
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];

      const isGroup = message.key.remoteJid?.endsWith("@g.us");
      const isStatus = message.key.remoteJid === "status@broadcast";

      if (isGroup || isStatus) return;

      // @ts-ignore
      const formattedMessage: FormattedMessage | undefined =
        getMessage(message);
      if (formattedMessage !== undefined) {
        MessageHandler(sock, formattedMessage);
      }
    }
  });

  // 📤 Listener para mensajes salientes (mensajes que envías tú)
  sock.ev.on("messages.upsert", ({ messages, type }: { messages: WAMessage[], type: string }) => {
    if (type === 'notify') {
      for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        
        // Solo mostrar mensajes que TÚ enviaste (no los que recibes)
        if (message.key.fromMe) {
          logger.info(`📤 MENSAJE SALIENTE:`);
          logger.info(`   👤 Para: ${message.key.remoteJid}`);
          logger.info(`   💬 Contenido: ${message.message?.conversation || message.message?.extendedTextMessage?.text || 'Sin contenido'}`);
          logger.info(`   📅 Timestamp: ${message.messageTimestamp ? new Date(Number(message.messageTimestamp) * 1000).toLocaleString() : 'Sin timestamp'}`);
          logger.info(`   📋 ID: ${message.key.id}`);
          //logger.info(`   ──────────────────────────────────────`);
        }
      }
    }
  });

  // Save credentials
  sock.ev.on("creds.update", saveCreds);
};
//bootstrap();
initWASocket();
