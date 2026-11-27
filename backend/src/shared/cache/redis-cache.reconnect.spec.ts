import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisCacheService } from './redis-cache.service';

jest.mock('ioredis', () => {
  const client = jest
    .fn()
    .mockImplementation(() => ({ status: 'wait', on: jest.fn(), connect: jest.fn().mockResolvedValue(undefined) }));
  return { __esModule: true, default: client, Redis: client };
});

/** Spec 031, US3 escenario 3: tras una caída, el cliente tiene que volver a conectarse solo. */
describe('RedisCacheService: reconexión', () => {
  beforeEach(() => jest.clearAllMocks());

  it('no conecta en el constructor sino al iniciar el módulo', () => {
    const service = new RedisCacheService({ get: (_key: string, fallback?: unknown) => fallback } as unknown as ConfigService);
    const [{ value: client }] = (Redis as unknown as jest.Mock).mock.results;
    expect(client.connect).not.toHaveBeenCalled();

    service.onModuleInit();

    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it('nunca deja de reintentar, con una espera creciente de hasta 5 segundos', () => {
    new RedisCacheService({ get: (_key: string, fallback?: unknown) => fallback } as unknown as ConfigService);

    const [[options]] = (Redis as unknown as jest.Mock).mock.calls;

    expect([1, 4, 10, 1000].map((attempt) => options.retryStrategy(attempt))).toEqual([200, 800, 2000, 5000]);
  });
});
