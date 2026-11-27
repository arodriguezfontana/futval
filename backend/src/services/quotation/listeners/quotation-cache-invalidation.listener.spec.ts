import { QuotationCacheInvalidationListener } from './quotation-cache-invalidation.listener';
import { QuoteRecalculatedEvent } from '../../../domain/alerts/events/quote-recalculated.event';
import { RedisCacheService } from '../../../shared/cache/redis-cache.service';

describe('QuotationCacheInvalidationListener', () => {
  let listener: QuotationCacheInvalidationListener;
  let mockCache: jest.Mocked<Partial<RedisCacheService>>;

  const event = (userId: string, playerId = 'player-1') => new QuoteRecalculatedEvent(userId, playerId, 25000, new Date());

  beforeEach(() => {
    mockCache = {
      delByPrefix: jest.fn().mockResolvedValue(undefined),
    };
    listener = new QuotationCacheInvalidationListener(mockCache as RedisCacheService);
  });

  it('invalida el prefijo de ranking del usuario al recibir quote.recalculated', async () => {
    await listener.handleQuoteRecalculated(event('user-123', 'player-456'));

    expect(mockCache.delByPrefix).toHaveBeenCalledWith('futval:ranking:user-123:');
  });

  it('una ráfaga simultánea de eventos del mismo usuario cuesta como mucho 2 purgas, no una por evento', async () => {
    const burst = Array.from({ length: 50 }, (_, i) => listener.handleQuoteRecalculated(event('user-123', `player-${i}`)));

    await Promise.all(burst);

    expect(mockCache.delByPrefix).toHaveBeenCalledTimes(2);
    expect(mockCache.delByPrefix).toHaveBeenCalledWith('futval:ranking:user-123:');
  });

  it('un evento posterior vuelve a invalidar: no hay ventana de tiempo que lo ignore (SC-004)', async () => {
    await listener.handleQuoteRecalculated(event('user-123', 'player-1'));
    await listener.handleQuoteRecalculated(event('user-123', 'player-2'));

    expect(mockCache.delByPrefix).toHaveBeenCalledTimes(2);
  });

  it('un evento que llega con una purga en curso dispara otra purga cuando la actual termina', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    (mockCache.delByPrefix as jest.Mock)
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            order.push('purga 1 empieza');
            releaseFirst = () => {
              order.push('purga 1 termina');
              resolve();
            };
          }),
      )
      .mockImplementationOnce(async () => {
        order.push('purga 2 empieza');
      });

    const first = listener.handleQuoteRecalculated(event('user-123', 'player-1'));
    const second = listener.handleQuoteRecalculated(event('user-123', 'player-2'));
    releaseFirst();
    await Promise.all([first, second]);

    // La segunda purga empieza DESPUÉS de que terminó la primera: el pedido nuevo nunca queda cubierto por una purga anterior.
    expect(order).toEqual(['purga 1 empieza', 'purga 1 termina', 'purga 2 empieza']);
  });

  it('los usuarios no se agrupan entre sí: cada uno se purga con su propio prefijo', async () => {
    await Promise.all([listener.handleQuoteRecalculated(event('user-1')), listener.handleQuoteRecalculated(event('user-2'))]);

    expect(mockCache.delByPrefix).toHaveBeenCalledWith('futval:ranking:user-1:');
    expect(mockCache.delByPrefix).toHaveBeenCalledWith('futval:ranking:user-2:');
    expect(mockCache.delByPrefix).toHaveBeenCalledTimes(2);
  });

  it('no deja temporizadores ni estado pendiente después de purgar', async () => {
    jest.useFakeTimers();
    try {
      await listener.handleQuoteRecalculated(event('user-123'));

      expect(jest.getTimerCount()).toBe(0);
      expect((listener as unknown as { active: Map<string, unknown> }).active.size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('invalidateUserRanking purga explícitamente el ranking del usuario indicado', async () => {
    await listener.invalidateUserRanking('user-999');

    expect(mockCache.delByPrefix).toHaveBeenCalledWith('futval:ranking:user-999:');
  });

  it('captura el error sin lanzar excepción si Redis falla', async () => {
    mockCache.delByPrefix = jest.fn().mockRejectedValue(new Error('Redis timeout'));

    await expect(listener.invalidateUserRanking('user-123')).resolves.not.toThrow();
  });

  it('si Redis falla en una purga, un evento posterior vuelve a intentarlo', async () => {
    (mockCache.delByPrefix as jest.Mock).mockRejectedValueOnce(new Error('Redis timeout'));

    await listener.handleQuoteRecalculated(event('user-123'));
    await listener.handleQuoteRecalculated(event('user-123'));

    expect(mockCache.delByPrefix).toHaveBeenCalledTimes(2);
  });

  it('sin RedisCacheService no hace nada', async () => {
    const withoutCache = new QuotationCacheInvalidationListener();

    await expect(withoutCache.handleQuoteRecalculated(event('user-123'))).resolves.toBeUndefined();
  });
});
