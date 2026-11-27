import * as request from 'supertest';
import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QuoteRecalculatedEvent, QUOTE_RECALCULATED_EVENT } from '../../src/domain/alerts/events/quote-recalculated.event';
import { PlayerEntity } from '../../src/repositories/player/entities/player.entity';
import { PlayerQuoteEntity } from '../../src/repositories/quotation/entities/player-quote.entity';
import { ValuationStrategyEntity } from '../../src/repositories/quotation/entities/valuation-strategy.entity';
import { createTestApp, TestContext } from '../test-app';

/**
 * Spec 031-redis-cache-fallback, SC-004: tras un recálculo, el ranking nunca devuelve valores anteriores.
 *
 * Regresión: el listener de invalidación ignoraba durante 2 segundos cualquier evento posterior del mismo usuario, así que
 * dos recálculos seguidos dejaban cacheado el ranking del primero. Con Redis real el test lo detecta; sin Redis el cache es
 * fail-open (no cachea nada) y el test pasa sin demostrar nada, por eso se corre con un Redis levantado.
 */
describe('E2E: coherencia del ranking cacheado tras recálculos seguidos (Spec 031, SC-004)', () => {
  let ctx: TestContext;
  let token: string;
  let userId: string;
  let player: PlayerEntity;
  let strategyId: string;
  const server = () => ctx.app.getHttpServer();

  const ranking = async () =>
    (await request(server()).get('/players/ranking?page=1&pageSize=10').set('Authorization', `Bearer ${token}`).expect(200)).body;

  /** Guarda una cotización nueva (más reciente que las anteriores) y emite el evento que dispara el recálculo real. */
  const recalculateTo = async (value: number, secondsFromBase: number) => {
    const calculatedAt = new Date(Date.now() + secondsFromBase * 1000);
    await ctx.dataSource.getRepository(PlayerQuoteEntity).save({
      id: randomUUID(),
      userId,
      playerId: player.id,
      strategyId,
      value: String(value),
      score: '8.0',
      weightSnapshot: {},
      factorEscalaSnapshot: '1',
      appliedPosition: null,
      calculatedAt,
    });
    await ctx.app.get(EventEmitter2).emitAsync(QUOTE_RECALCULATED_EVENT, new QuoteRecalculatedEvent(userId, player.id, value, calculatedAt));
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.clearUsers();
    await ctx.dataSource.query('DELETE FROM "players"');

    const email = `coherencia-${randomUUID()}@futval.com`;
    const register = await request(server()).post('/auth/register').send({ email, password: 'Password123!', username: 'coherencia' });
    userId = register.body.id as string;
    const login = await request(server()).post('/auth/login').send({ email, password: 'Password123!' });
    token = login.body.accessToken as string;

    player = await ctx.dataSource.getRepository(PlayerEntity).save({
      id: randomUUID(),
      externalId: `ext-${randomUUID()}`,
      name: 'Jugador Coherencia',
      league: 'La Liga',
      team: 'FC Test',
      position: 'FW',
      rating: 8,
      removedAt: null,
    });
    const strategies = await ctx.dataSource.getRepository(ValuationStrategyEntity).find({ where: { userId } });
    strategyId = strategies[0].id;
  });

  afterAll(async () => {
    await ctx.clearUsers();
    await ctx.close();
  });

  it('dos recálculos con menos de 2 segundos de diferencia: el ranking refleja siempre el último valor', async () => {
    await recalculateTo(1000, 0);
    expect((await ranking()).items[0].valor).toBe(1000); // queda cacheado

    await recalculateTo(2000, 1);
    expect((await ranking()).items[0].valor).toBe(2000); // queda cacheado

    // Segundo recálculo del mismo usuario, apenas después del primero (antes la ventana de 2 s lo ignoraba).
    await recalculateTo(3000, 2);
    expect((await ranking()).items[0].valor).toBe(3000);
  });

  it('una ráfaga de eventos simultáneos del mismo usuario deja el ranking con el último valor', async () => {
    await recalculateTo(4000, 3);
    await ranking(); // cachea 4000

    const calculatedAt = new Date(Date.now() + 4000);
    await ctx.dataSource.getRepository(PlayerQuoteEntity).save({
      id: randomUUID(),
      userId,
      playerId: player.id,
      strategyId,
      value: '5000',
      score: '8.0',
      weightSnapshot: {},
      factorEscalaSnapshot: '1',
      appliedPosition: null,
      calculatedAt,
    });
    const emitter = ctx.app.get(EventEmitter2);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        emitter.emitAsync(QUOTE_RECALCULATED_EVENT, new QuoteRecalculatedEvent(userId, `${player.id}-${i}`, 5000, calculatedAt)),
      ),
    );

    expect((await ranking()).items[0].valor).toBe(5000);
  });
});
