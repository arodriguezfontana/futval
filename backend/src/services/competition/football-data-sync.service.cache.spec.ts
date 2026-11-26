import { Logger } from '@nestjs/common';
import { FootballDataAdapter } from '../../adapters/competition/football-data-adapter';
import { MatchRepository } from '../../repositories/competition/match.repository';
import { StandingRepository } from '../../repositories/competition/standing.repository';
import { RedisCacheService } from '../../shared/cache/redis-cache.service';
import { FootballDataSyncService } from './football-data-sync.service';

/** Spec 031 (FR-007): una sync de Football-Data también descarta lo cacheado. */
describe('FootballDataSyncService: invalidación de caché', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('al terminar la corrida descarta catálogo, detalle y rankings', async () => {
    const delByPrefix = jest.fn().mockResolvedValue(undefined);
    const adapter: FootballDataAdapter = {
      fetchStandings: jest.fn().mockResolvedValue([]),
      fetchMatches: jest.fn().mockResolvedValue([]),
    };
    const service = new FootballDataSyncService(
      adapter,
      {} as MatchRepository,
      {} as StandingRepository,
      undefined,
      undefined,
      { delByPrefix } as unknown as RedisCacheService,
    );
    service.setRequestDelay(0);

    await service.triggerManualRun();

    expect(delByPrefix.mock.calls.map(([prefix]) => prefix)).toEqual(['futval:catalog:', 'futval:player:', 'futval:ranking:']);
  });
});
