# 🤖 Bot de WhatsApp con NestJS y Baileys

## 📋 Descripción del Proyecto

Este proyecto implementa un bot de WhatsApp usando **NestJS** como framework backend y **Baileys** como librería para conectarse a WhatsApp Web. El bot puede recibir mensajes, procesarlos y responder automáticamente.

## 🏗️ Arquitectura del Proyecto

```
src/
├── main.ts                          # 🚀 Punto de entrada principal
├── app.module.ts                    # 📦 Módulo principal de NestJS
├── app.controller.ts                # 🎮 Controlador de la API
├── app.service.ts                   # ⚙️ Servicios de la aplicación
└── baileys-conector/               # 📱 Conector de WhatsApp
    ├── handlers/
    │   └── message.ts              # 🎯 Manejador de mensajes
    └── utils/
        ├── logger.ts               # 📝 Sistema de logging
        └── message.ts              # 🔧 Utilidades para mensajes
```

## 🚀 Análisis Detallado del `main.ts`

### 📦 **Importaciones Principales**

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import makeWASocket, { Browsers, DisconnectReason, fetchLatestWaWebVersion, useMultiFileAuthState, WAMessage } from 'baileys';
import * as qrcode from 'qrcode';
import { Boom } from '@hapi/boom';
import { logger } from './baileys-conector/utils/logger';
import { FormattedMessage } from './baileys-conector/utils/message';
import MessageHandler from './baileys-conector/handlers/message';
import { getMessage } from './baileys-conector/utils/message';
```

**¿Qué hace cada importación?**

| Importación | Propósito |
|-------------|-----------|
| `NestFactory` | Crea la aplicación NestJS |
| `AppModule` | Módulo principal de la aplicación |
| `makeWASocket` | Función principal de Baileys para crear conexión |
| `Browsers` | Configuración del navegador para WhatsApp Web |
| `DisconnectReason` | Razones de desconexión de WhatsApp |
| `fetchLatestWaWebVersion` | Obtiene la versión más reciente de WhatsApp |
| `useMultiFileAuthState` | Maneja el estado de autenticación en archivos |
| `WAMessage` | Tipo de mensaje de WhatsApp |
| `qrcode` | Genera códigos QR para autenticación |
| `Boom` | Manejo de errores HTTP |
| `logger` | Sistema de logging personalizado |
| `FormattedMessage` | Tipo personalizado para mensajes formateados |
| `MessageHandler` | Función que procesa los mensajes entrantes |
| `getMessage` | Utilidad para formatear mensajes de Baileys |

### ⚙️ **Configuración de Conexión**

```typescript
const CONNECTION_TYPE = "QR"; // "NUMBER" (se quiser usar o número para login)
const PHONE_NUMBER = "51982308431"; // +55 (68) 9200-0000 -> 556892000000 (formato para número)
const USE_LASTEST_VERSION = true;
```

**Explicación de las constantes:**

- **`CONNECTION_TYPE`**: Define el método de autenticación
  - `"QR"`: Usa código QR (recomendado para desarrollo)
  - `"NUMBER"`: Usa número de teléfono (requiere código de verificación)
- **`PHONE_NUMBER`**: Número de teléfono en formato internacional sin símbolos
- **`USE_LASTEST_VERSION`**: Si usar la versión más reciente de WhatsApp

### 🔧 **Función Principal: `initWASocket()`**

Esta es la función más importante del archivo. Vamos a analizarla paso a paso:

#### **1. Inicialización del Estado de Autenticación**

```typescript
const { state, saveCreds } = await useMultiFileAuthState("auth");
```

**¿Qué hace?**
- Crea una carpeta llamada `"auth"` en tu proyecto
- Guarda las credenciales de WhatsApp en archivos dentro de esa carpeta
- `state`: Contiene el estado actual de autenticación
- `saveCreds`: Función que guarda automáticamente las credenciales cuando cambian

**¿Por qué es importante?**
- Permite reconectarse sin necesidad de escanear QR nuevamente
- Las credenciales se mantienen entre reinicios del bot

#### **2. Obtención de la Versión de WhatsApp**

```typescript
const { version, isLatest } = await fetchLatestWaWebVersion({});
```

**¿Qué hace?**
- Se conecta a los servidores de WhatsApp para obtener la versión más reciente
- `version`: Array con números de versión (ej: [2, 3000, 1026279417])
- `isLatest`: Boolean que indica si es la versión más reciente

**¿Por qué es importante?**
- Evita errores de compatibilidad
- WhatsApp actualiza frecuentemente su protocolo

#### **3. Creación del Socket de WhatsApp**

```typescript
const sock = makeWASocket({
  auth: state,
  browser: CONNECTION_TYPE === "NUMBER" 
    ? Browsers.ubuntu("Chrome") 
    : Browsers.appropriate("Desktop"),
  printQRInTerminal: false,
  version: USE_LASTEST_VERSION ? version : undefined,
  defaultQueryTimeoutMs: 0,
});
```

**Parámetros explicados:**

| Parámetro | Valor | Explicación |
|-----------|-------|-------------|
| `auth` | `state` | Estado de autenticación obtenido anteriormente |
| `browser` | `Browsers.appropriate("Desktop")` | Simula un navegador desktop para WhatsApp Web |
| `printQRInTerminal` | `false` | No mostrar QR en terminal (usamos qrcode personalizado) |
| `version` | `version` | Versión específica de WhatsApp a usar |
| `defaultQueryTimeoutMs` | `0` | Sin timeout para consultas |

#### **4. Manejo de Autenticación por Número**

```typescript
if (CONNECTION_TYPE === "NUMBER" && !sock.authState.creds.registered) {
  try {
    const code = await sock.requestPairingCode(PHONE_NUMBER);
    logger.info(`Code: ${code}`);
  } catch (error) {
    logger.error("Error getting code.");
  }
}
```

**¿Cuándo se ejecuta?**
- Solo si `CONNECTION_TYPE` es `"NUMBER"`
- Y si el número no está registrado en WhatsApp

**¿Qué hace?**
- Solicita un código de verificación al número especificado
- El código se envía por SMS al teléfono
- Se muestra en los logs para que el usuario lo ingrese

### 📡 **Sistema de Eventos**

El bot funciona mediante un sistema de eventos. Baileys emite eventos cuando suceden cosas en WhatsApp.

#### **Evento: `connection.update`**

```typescript
sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }: any) => {
  logger.info(`Socket Connection Update: ${connection || ""} ${lastDisconnect || ""}`);

  switch (connection) {
    case "close":
      logger.error("Connection closed");
      const shouldReconnect = (lastDisconnect.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        setTimeout(() => initWASocket(), 5000);
      }
      break;
    case "open":
      logger.info("Bot Connected");
      break;
  }

  if (qr !== undefined && CONNECTION_TYPE === "QR") {
    qrcode.toString(qr, { small: true }).then((qrString) => {
      console.log(qrString);
    }).catch((err) => {
      logger.error('Error generating QR:', err);
    });
  }
});
```

**Estados de conexión:**

| Estado | Descripción | Acción del Bot |
|--------|-------------|----------------|
| `"connecting"` | Intentando conectar | Muestra log de conexión |
| `"open"` | Conectado exitosamente | Muestra "Bot Connected" |
| `"close"` | Conexión cerrada | Intenta reconectar en 5 segundos |

**Manejo de reconexión:**
- Solo reconecta si no fue un logout manual
- Espera 5 segundos antes de intentar reconectar
- Evita bucles infinitos de reconexión

**Generación de QR:**
- Solo si `CONNECTION_TYPE` es `"QR"`
- Usa la librería `qrcode` para generar un QR legible
- Muestra el QR en la consola para escanear

#### **Evento: `messages.upsert`**

```typescript
sock.ev.on("messages.upsert", ({ messages }: { messages: WAMessage[] }) => {
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];

    const isGroup = message.key.remoteJid?.endsWith("@g.us");
    const isStatus = message.key.remoteJid === "status@broadcast";

    if (isGroup || isStatus) return;

    const formattedMessage: FormattedMessage | undefined = getMessage(message);
    if (formattedMessage !== undefined) {
      MessageHandler(sock, formattedMessage);
    }
  }
});
```

**¿Qué hace este evento?**
- Se ejecuta cada vez que llega un mensaje a WhatsApp
- `messages` es un array porque pueden llegar varios mensajes a la vez

**Filtrado de mensajes:**
- **Grupos**: `message.key.remoteJid?.endsWith("@g.us")`
- **Estados**: `message.key.remoteJid === "status@broadcast"`
- Solo procesa mensajes privados (no grupos ni estados)

**Procesamiento:**
- Convierte el mensaje de Baileys a formato personalizado
- Envía el mensaje al `MessageHandler` para procesamiento

#### **Evento: `creds.update`**

```typescript
sock.ev.on("creds.update", saveCreds);
```

**¿Qué hace?**
- Se ejecuta cuando cambian las credenciales de WhatsApp
- Guarda automáticamente las nuevas credenciales en archivos
- Permite reconexión automática sin escanear QR

### 🎯 **Inicialización del Bot**

```typescript
//bootstrap();
initWASocket();
```

**¿Por qué está comentado `bootstrap()`?**
- `bootstrap()` inicia el servidor NestJS (API REST)
- `initWASocket()` inicia solo el bot de WhatsApp
- En este caso, solo queremos el bot, no la API

## 🤖 Funcionalidades del Bot

### 📱 **Comandos Disponibles**

El bot responde automáticamente a estos comandos:

| Comando | Respuesta | Descripción |
|---------|-----------|-------------|
| `hola`, `oi`, `hello` | Saludo personalizado | Saluda al usuario |
| `info`, `ayuda`, `help` | Lista de comandos | Muestra comandos disponibles |
| `hora` | Hora actual | Muestra hora en zona horaria de Lima |
| `estado` | Estado del bot | Información del estado del bot |
| `echo [texto]` | Repite el texto | Función de eco para pruebas |
| Cualquier otro | Respuesta por defecto | Mensaje genérico con instrucciones |

### 📊 **Logs del Sistema**

El bot genera logs detallados para cada mensaje:

```
INFO [12:15:30.123] (12345): 📨 Mensaje recibido:
INFO [12:15:30.124] (12345):    👤 De: Juan Pérez (51982308431@s.whatsapp.net)
INFO [12:15:30.125] (12345):    💬 Contenido: hola
INFO [12:15:30.126] (12345):    📅 Timestamp: 25/8/2025, 12:15:30
INFO [12:15:30.127] (12345):    📋 ID: 3A1234567890ABCDEF
INFO [12:15:30.128] (12345):    ──────────────────────────────────────
INFO [12:15:30.129] (12345): ✅ Respondí con saludo
```

## 🛠️ Instalación y Uso

### 📋 **Requisitos Previos**

- Node.js (versión 18 o superior)
- npm o yarn
- Cuenta de WhatsApp

### 🚀 **Instalación**

```bash
# Clonar el repositorio
git clone <url-del-repositorio>
cd whatapp-conector-service

# Instalar dependencias
npm install

# Iniciar el bot
npm run start
```

### 📱 **Primera Conexión**

1. Ejecuta `npm run start`
2. Escanea el código QR que aparece en la consola
3. El bot se conectará automáticamente
4. Envía "ayuda" para ver los comandos disponibles

## 🎓 **Conceptos Clave para Alumnos**

### 🔄 **Programación Asíncrona**
- `async/await`: Manejo de operaciones que toman tiempo
- Promesas: Operaciones que se completan en el futuro
- Eventos: Respuesta a acciones que suceden en tiempo real

### 📡 **Sistema de Eventos**
- **Event-driven programming**: El código responde a eventos
- **Event listeners**: Funciones que se ejecutan cuando sucede algo
- **Event emitters**: Objetos que emiten eventos

### 🔐 **Autenticación y Seguridad**
- **Tokens de sesión**: Credenciales que permiten acceso
- **Persistencia**: Guardar datos entre sesiones
- **Reconexión automática**: Manejo de desconexiones

### 🏗️ **Arquitectura de Software**
- **Separación de responsabilidades**: Cada archivo tiene una función específica
- **Modularidad**: Código organizado en módulos reutilizables
- **Configuración**: Parámetros que se pueden cambiar fácilmente

## 🧪 **Ejercicios Prácticos para Alumnos**

### 📝 **Nivel Básico**
1. **Cambiar respuestas**: Modifica los mensajes de respuesta del bot
2. **Agregar comandos**: Crea nuevos comandos como "clima" o "chiste"
3. **Personalizar logs**: Cambia el formato de los logs

### 🔧 **Nivel Intermedio**
1. **Manejar diferentes tipos de mensaje**: Imágenes, audio, documentos
2. **Implementar base de datos**: Guardar información de usuarios
3. **Crear menús interactivos**: Botones y listas de WhatsApp

### 🚀 **Nivel Avanzado**
1. **Integración con APIs**: Conectar con servicios externos
2. **Sistema de usuarios**: Gestión de permisos y roles
3. **Analytics**: Estadísticas de uso del bot

## 🐛 **Solución de Problemas Comunes**

### ❌ **Error: "unable to determine transport target for pino-pretty"**
**Solución:** Instalar pino-pretty
```bash
npm install pino-pretty
```

### ❌ **Error: "qrcode.generate is not a function"**
**Solución:** Cambiar la importación de qrcode
```typescript
// ❌ Incorrecto
import qrcode from 'qrcode';

// ✅ Correcto
import * as qrcode from 'qrcode';
```

### ❌ **Bot no responde a mensajes**
**Verificar:**
1. Que el bot esté conectado (debe mostrar "Bot Connected")
2. Que los mensajes no sean de grupos
3. Que el MessageHandler esté funcionando correctamente

### ❌ **Problemas de reconexión**
**Verificar:**
1. Que la carpeta "auth" exista y tenga permisos
2. Que las credenciales se guarden correctamente
3. Que no haya múltiples instancias del bot ejecutándose

## 📚 **Recursos Adicionales**

- [Documentación de Baileys](https://github.com/whiskeysockets/baileys)
- [Documentación de NestJS](https://nestjs.com/)
- [Guía de WhatsApp Web](https://web.whatsapp.com/)

## 👨‍🏫 **Para Profesores**

Este proyecto es ideal para enseñar:
- **Programación asíncrona** con async/await
- **Sistemas de eventos** en JavaScript/TypeScript
- **APIs de terceros** y integración
- **Logging y debugging** en aplicaciones reales
- **Arquitectura de software** y organización de código

---

**¡Disfruta aprendiendo con tu bot de WhatsApp! 🤖📱**
