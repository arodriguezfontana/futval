import { Logger } from '@nestjs/common';
import { FootballDataAdapter } from '../../adapters/competition/football-data-adapter';
import { FixedClock } from '../../adapters/runtime/fake-runtime';
import { MatchRepository } from '../../repositories/competition/match.repository';
import { StandingRepository } from '../../repositories/competition/standing.repository';
import { SyncLastSuccessService } from '../sync/sync-last-success.service';
import { FootballDataSyncService } from './football-data-sync.service';

/** 031: sólo una corrida de Football-Data sin ligas fallidas avanza la última sync exitosa. */
describe('FootballDataSyncService — última sync exitosa', () => {
  let adapter: jest.Mocked<FootballDataAdapter>;
  let lastSuccess: { record: jest.Mock };

  const build = () => {
    const service = new FootballDataSyncService(
      adapter,
      {} as MatchRepository,
      {} as StandingRepository,
      lastSuccess as unknown as SyncLastSuccessService,
      new FixedClock(),
    );
    service.setRequestDelay(0);
    return service;
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    adapter = { fetchStandings: jest.fn().mockResolvedValue([]), fetchMatches: jest.fn().mockResolvedValue([]) };
    lastSuccess = { record: jest.fn().mockResolvedValue(undefined) };
  });

  afterEach(() => jest.restoreAllMocks());

  it('con todas las ligas bien la avanza (manual y programada)', async () => {
    await build().triggerManualRun();
    await build().handleCron();

    expect(lastSuccess.record).toHaveBeenCalledTimes(2);
    expect(lastSuccess.record).toHaveBeenCalledWith('football_data', new Date('2026-10-26T12:00:00.000Z'));
  });

  it('si falla una liga NO la avanza', async () => {
    adapter.fetchStandings.mockImplementation((code) =>
      code === 'PD' ? Promise.reject(new Error('proveedor caído')) : Promise.resolve([]),
    );

    await build().triggerManualRun();

    expect(lastSuccess.record).not.toHaveBeenCalled();
  });

  it('si la corrida se aborta NO la avanza', async () => {
    const service = build();
    jest.spyOn(service, 'syncAllLeagues').mockRejectedValue(new Error('inesperado'));

    await service.handleCron();

    expect(lastSuccess.record).not.toHaveBeenCalled();
  });

  it('si registrar la fecha falla, el resumen de la corrida no cambia', async () => {
    lastSuccess.record.mockRejectedValue(new Error('base caída'));

    await expect(build().triggerManualRun()).resolves.toMatchObject({ failedLeagues: [] });
  });
});
