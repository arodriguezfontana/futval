import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  QUOTE_RECALCULATED_EVENT,
  QuoteRecalculatedEvent,
} from '../../../domain/alerts/events/quote-recalculated.event';
import { RedisCacheService } from '../../../shared/cache/redis-cache.service';

/** Invalidación en curso de un usuario: `dirty` indica que llegó otro pedido mientras se purgaba. */
interface ActivePurge {
  dirty: boolean;
  done: Promise<void>;
}

/**
 * Descarta el ranking cacheado de un usuario cuando se recalculan sus cotizaciones.
 *
 * Un recálculo emite un `quote.recalculated` por cada cotización guardada, así que llegan muchos eventos casi a la vez
 * para el mismo usuario. En vez de purgar una vez por evento, los pedidos se **agrupan**: si ya hay una purga en curso
 * para ese usuario, el pedido nuevo no la duplica sino que pide UNA más cuando la actual termine (`dirty`). Así:
 *
 * - una ráfaga de N eventos cuesta como mucho 2 purgas, no N;
 * - toda purga empieza DESPUÉS del evento que la pidió, de modo que ningún ranking puede quedar cacheado con valores
 *   anteriores a un recálculo (SC-004). La versión anterior ignoraba, durante 2 segundos, cualquier evento posterior
 *   del mismo usuario y podía dejar un ranking viejo tras dos recálculos seguidos;
 * - no hay temporizadores ni estado que sobreviva a la purga.
 */
@Injectable()
export class QuotationCacheInvalidationListener {
  private readonly logger = new Logger(QuotationCacheInvalidationListener.name);
  private readonly active = new Map<string, ActivePurge>();

  constructor(@Optional() private readonly cache?: RedisCacheService) {}

  @OnEvent(QUOTE_RECALCULATED_EVENT, { async: true })
  async handleQuoteRecalculated(event: QuoteRecalculatedEvent): Promise<void> {
    await this.invalidateUserRanking(event.userId);
  }

  /** Purga el ranking del usuario, agrupando pedidos simultáneos. Nunca lanza: si Redis falla se registra y se sigue. */
  async invalidateUserRanking(userId: string): Promise<void> {
    if (!this.cache) return;

    const current = this.active.get(userId);
    if (current) {
      current.dirty = true;
      return current.done;
    }

    const entry: ActivePurge = { dirty: false, done: Promise.resolve() };
    this.active.set(userId, entry);
    entry.done = this.purgeUntilClean(userId, entry);
    return entry.done;
  }

  private async purgeUntilClean(userId: string, entry: ActivePurge): Promise<void> {
    try {
      do {
        entry.dirty = false;
        await this.purge(userId);
      } while (entry.dirty);
    } finally {
      this.active.delete(userId);
    }
  }

  private async purge(userId: string): Promise<void> {
    try {
      await this.cache?.delByPrefix(`futval:ranking:${userId}:`);
      this.logger.debug(`Caché de ranking purgada para usuario ${userId}`);
    } catch (err) {
      this.logger.warn(
        `Fallo al invalidar caché de ranking para usuario ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
