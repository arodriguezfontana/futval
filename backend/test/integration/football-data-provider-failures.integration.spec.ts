import axios from 'axios';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { HttpFootballDataAdapter } from '../../src/adapters/competition/http-football-data-adapter';
import { MatchRepository } from '../../src/repositories/competition/match.repository';
import { StandingRepository } from '../../src/repositories/competition/standing.repository';
import { RedisCacheService } from '../../src/shared/cache/redis-cache.service';
import { FootballDataSyncService, TARGET_LEAGUES } from '../../src/services/competition/football-data-sync.service';
import { SyncLastSuccessService } from '../../src/services/sync/sync-last-success.service';

/**
 * Spec 031-redis-cache-fallback, US3 (FR-009/FR-010): fallas REALES del proveedor externo. Se levanta un servidor HTTP local
 * que responde 200, 500, 429, tarda más que el timeout o desaparece (conexión rechazada), y se ejercita el adaptador real
 * con axios real (no un mock de axios). El cache es un doble en memoria (no hace falta Redis para esta prueba).
 */
describe('Football-Data: fallas reales del proveedor y fallback (spec 031, US3)', () => {
  const STANDINGS = {
    standings: [
      {
        type: 'TOTAL',
        table: [
          {
            position: 1,
            team: { id: 65, name: 'Manchester City FC', crest: 'https://crests.football-data.org/65.png' },
            playedGames: 5,
            form: 'W,W,W,D,W',
            won: 4,
            draw: 1,
            lost: 0,
            points: 13,
            goalsFor: 12,
            goalsAgainst: 3,
            goalDifference: 9,
          },
        ],
      },
    ],
  };

  type Mode = 'ok' | 'error-500' | 'error-429' | 'slow';
  let mode: Mode = 'ok';
  let server: http.Server | null;
  let baseURL: string;
  let store: Map<string, unknown>;
  let cache: RedisCacheService;

  const startServer = async () => {
    server = http.createServer((_req, res) => {
      if (mode === 'ok') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(STANDINGS));
      } else if (mode === 'error-500') {
        res.writeHead(500).end('boom');
      } else if (mode === 'error-429') {
        res.writeHead(429, { 'retry-after': '60' }).end('too many requests');
      } else {
        setTimeout(() => res.writeHead(200).end(JSON.stringify(STANDINGS)), 1500);
      }
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    baseURL = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  };

  const stopServer = async () => {
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  };

  const adapterWith = (withCache: boolean) =>
    new HttpFootballDataAdapter(axios.create({ baseURL, timeout: 300 }), withCache ? cache : undefined);

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mode = 'ok';
    store = new Map();
    cache = {
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      set: jest.fn(async (key: string, value: unknown) => {
        store.set(key, value);
      }),
    } as unknown as RedisCacheService;
    await startServer();
  });

  afterEach(async () => {
    await stopServer();
    jest.restoreAllMocks();
  });

  it('con el proveedor sano devuelve los datos y los guarda en el cache', async () => {
    const rows = await adapterWith(true).fetchStandings('PL');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ teamId: 65, teamName: 'Manchester City FC', points: 13 });
    expect(store.has('futval:external:standings:PL')).toBe(true);
  });

  describe.each<[string, () => Promise<void>]>([
    ['HTTP 500', async () => void (mode = 'error-500')],
    ['HTTP 429 (límite de cuota)', async () => void (mode = 'error-429')],
    ['timeout (el proveedor tarda más que el límite)', async () => void (mode = 'slow')],
    ['conexión rechazada (proveedor caído)', async () => stopServer()],
  ])('si el proveedor falla con %s', (_name, breakProvider) => {
    it('sirve los datos que ya estaban en el cache, sin lanzar', async () => {
      await adapterWith(true).fetchStandings('PL'); // puebla el cache con el proveedor sano
      await breakProvider();

      const rows = await adapterWith(true).fetchStandings('PL');

      expect(rows).toHaveLength(1);
      expect(rows[0].teamName).toBe('Manchester City FC');
    });

    it('sin nada en cache propaga el error (no devuelve [] como si la liga estuviera vacía)', async () => {
      await breakProvider();

      await expect(adapterWith(true).fetchStandings('PL')).rejects.toBeDefined();
      await expect(adapterWith(false).fetchStandings('PL')).rejects.toBeDefined();
    });
  });

  describe('la sincronización registra la falla en vez de dar por buena una corrida vacía', () => {
    const build = (withCache: boolean) => {
      const lastSuccess = { record: jest.fn().mockResolvedValue(undefined) };
      const service = new FootballDataSyncService(
        adapterWith(withCache),
        { upsertMatches: jest.fn().mockResolvedValue(undefined) } as unknown as MatchRepository,
        { upsertStandings: jest.fn().mockResolvedValue(undefined) } as unknown as StandingRepository,
        lastSuccess as unknown as SyncLastSuccessService,
      );
      service.setRequestDelay(0);
      return { service, lastSuccess };
    };

    it('proveedor caído y sin cache: todas las ligas fallan -> la última sync exitosa NO avanza', async () => {
      mode = 'error-500';
      const { service, lastSuccess } = build(false);

      const summary = await service.triggerManualRun();

      expect(summary.failedLeagues).toHaveLength(TARGET_LEAGUES.length);
      expect(lastSuccess.record).not.toHaveBeenCalled();
    });

    it('proveedor sano: avanza la última sync', async () => {
      const { service, lastSuccess } = build(true);

      const summary = await service.triggerManualRun();

      expect(summary.failedLeagues).toEqual([]);
      expect(lastSuccess.record).toHaveBeenCalledWith('football_data', expect.any(Date));
    });
  });
});
