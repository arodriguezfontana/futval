import { Logger } from '@nestjs/common';
import { WhoScoredAdapter, WhoScoredLeagueTeams } from '../../adapters/player-sync/whoscored-adapter';
import { FixedClock, SequentialIdGenerator } from '../../adapters/runtime/fake-runtime';
import { League } from '../../domain/player/enums/league';
import { PlayerRepository } from '../../repositories/player/player.repository';
import { SyncLastSuccessService } from '../sync/sync-last-success.service';
import { PlayerSyncService } from './player-sync.service';

const oneTeam: WhoScoredLeagueTeams = {
  tournamentId: 2,
  teams: [{ externalTeamId: 't1', team: 'Equipo Uno' }],
  seedPlayerByTeam: new Map([['t1', 'seed-t1']]),
};

/** 031: sólo una corrida de WhoScored con todas las unidades bien avanza la última sync exitosa. */
describe('PlayerSyncService — última sync exitosa', () => {
  let whoScored: jest.Mocked<WhoScoredAdapter>;
  let players: jest.Mocked<PlayerRepository>;
  let lastSuccess: { record: jest.Mock };

  const build = () =>
    new PlayerSyncService(
      whoScored,
      players,
      new FixedClock(),
      new SequentialIdGenerator('run'),
      lastSuccess as unknown as SyncLastSuccessService,
    );

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    whoScored = {
      fetchLeagueTeams: jest.fn().mockImplementation((league) =>
        Promise.resolve(league === League.PREMIER_LEAGUE ? oneTeam : { ...oneTeam, teams: [] }),
      ),
      fetchTeamRoster: jest.fn().mockResolvedValue([]),
    };
    players = {
      findActiveExternalIdsByTeam: jest.fn().mockResolvedValue([]),
      applyTeamRosterSync: jest.fn().mockResolvedValue(undefined),
    } as unknown as typeof players;
    lastSuccess = { record: jest.fn().mockResolvedValue(undefined) };
  });

  afterEach(() => jest.restoreAllMocks());

  it('si ninguna unidad falla la avanza', async () => {
    whoScored.fetchLeagueTeams.mockResolvedValue({ ...oneTeam, teams: [] });

    await build().sync();

    expect(lastSuccess.record).toHaveBeenCalledWith('whoscored', new Date('2026-10-26T12:00:00.000Z'));
  });

  it('si falla una unidad NO la avanza', async () => {
    whoScored.fetchTeamRoster.mockRejectedValue(new Error('plantel caído'));

    await build().sync();

    expect(lastSuccess.record).not.toHaveBeenCalled();
  });

  it('si no se puede leer ninguna liga NO la avanza', async () => {
    whoScored.fetchLeagueTeams.mockRejectedValue(new Error('proveedor caído'));

    await build().sync();

    expect(lastSuccess.record).not.toHaveBeenCalled();
  });

  it('si registrar la fecha falla, la corrida no lanza', async () => {
    whoScored.fetchLeagueTeams.mockResolvedValue({ ...oneTeam, teams: [] });
    lastSuccess.record.mockRejectedValue(new Error('base caída'));

    await expect(build().sync()).resolves.toBeUndefined();
  });
});
