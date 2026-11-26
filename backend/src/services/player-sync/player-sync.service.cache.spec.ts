import { Logger } from '@nestjs/common';
import { WhoScoredAdapter } from '../../adapters/player-sync/whoscored-adapter';
import { FixedClock, SequentialIdGenerator } from '../../adapters/runtime/fake-runtime';
import { PlayerRepository } from '../../repositories/player/player.repository';
import { RedisCacheService } from '../../shared/cache/redis-cache.service';
import { PlayerSyncService } from './player-sync.service';

/** Spec 031 (FR-007): al terminar una sync de jugadores no puede quedar cacheado nada que muestre datos de antes. */
describe('PlayerSyncService: invalidación de caché', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('descarta catálogo, detalle y rankings (que excluyen a los jugadores dados de baja)', async () => {
    const whoScored: WhoScoredAdapter = {
      fetchLeagueTeams: jest.fn().mockResolvedValue({ tournamentId: 2, teams: [], seedPlayerByTeam: new Map() }),
      fetchTeamRoster: jest.fn(),
    };
    const delByPrefix = jest.fn().mockResolvedValue(undefined);
    const service = new PlayerSyncService(
      whoScored,
      {} as PlayerRepository,
      new FixedClock(),
      new SequentialIdGenerator('run'),
      undefined,
      { delByPrefix } as unknown as RedisCacheService,
    );

    await service.sync();

    expect(delByPrefix.mock.calls.map(([prefix]) => prefix)).toEqual(['futval:catalog:', 'futval:player:', 'futval:ranking:']);
  });
});
