import { WAMessage } from 'baileys';
import { logger } from './logger';

export interface QueuedMessage {
  message: WAMessage;
  retryCount: number;
  maxRetries: number;
  timestamp: number;
  priority: 'high' | 'normal' | 'low';
}

export class MessageQueue {
  private queue: QueuedMessage[] = [];
  private processing = false;
  private maxRetries = 5;
  private retryDelay = 1000; // 1 segundo

  /**
   * Agrega un mensaje a la cola para reintento
   */
  addToQueue(message: WAMessage, priority: 'high' | 'normal' | 'low' = 'normal'): void {
    const queuedMessage: QueuedMessage = {
      message,
      retryCount: 0,
      maxRetries: this.maxRetries,
      timestamp: Date.now(),
      priority,
    };

    // Insertar según prioridad
    if (priority === 'high') {
      this.queue.unshift(queuedMessage);
    } else {
      this.queue.push(queuedMessage);
    }

    logger.info(`📥 Mensaje ${message.key.id} agregado a la cola de reintentos (prioridad: ${priority})`);
    
    // Iniciar procesamiento si no está activo
    if (!this.processing) {
      this.processQueue();
    }
  }

  /**
   * Procesa la cola de mensajes
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const queuedMessage = this.queue.shift();
      if (!queuedMessage) continue;

      try {
        // Intentar procesar el mensaje
        const success = await this.retryMessage(queuedMessage);
        
        if (!success && queuedMessage.retryCount < queuedMessage.maxRetries) {
          // Reintentar con delay exponencial
          const delay = this.retryDelay * Math.pow(2, queuedMessage.retryCount);
          queuedMessage.retryCount++;
          
          logger.info(`🔄 Reintentando mensaje ${queuedMessage.message.key.id} en ${delay}ms (intento ${queuedMessage.retryCount}/${queuedMessage.maxRetries})`);
          
          setTimeout(() => {
            this.queue.push(queuedMessage);
            this.processQueue();
          }, delay);
        } else if (!success) {
          logger.error(`❌ Mensaje ${queuedMessage.message.key.id} falló después de ${queuedMessage.maxRetries} intentos`);
        }
      } catch (error) {
        logger.error(`Error procesando mensaje en cola:`, error);
      }
    }

    this.processing = false;
  }

  /**
   * Intenta procesar un mensaje de la cola
   */
  private async retryMessage(queuedMessage: QueuedMessage): Promise<boolean> {
    try {
      // Aquí implementarías la lógica de reintento
      // Por ahora, simulamos un intento
      const success = Math.random() > 0.5; // Simulación
      
      if (success) {
        logger.info(`✅ Mensaje ${queuedMessage.message.key.id} procesado exitosamente en reintento ${queuedMessage.retryCount + 1}`);
      }
      
      return success;
    } catch (error) {
      logger.error(`Error en reintento de mensaje ${queuedMessage.message.key.id}:`, error);
      return false;
    }
  }

  /**
   * Obtiene estadísticas de la cola
   */
  getStats(): { queueLength: number; processing: boolean } {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
    };
  }

  /**
   * Limpia mensajes antiguos de la cola
   */
  cleanup(maxAge: number = 5 * 60 * 1000): void { // 5 minutos por defecto
    const now = Date.now();
    const initialLength = this.queue.length;
    
    this.queue = this.queue.filter(msg => (now - msg.timestamp) < maxAge);
    
    const removedCount = initialLength - this.queue.length;
    if (removedCount > 0) {
      logger.info(`🧹 Limpieza de cola: ${removedCount} mensajes antiguos removidos`);
    }
  }
}

// Instancia global de la cola
export const messageQueue = new MessageQueue();
