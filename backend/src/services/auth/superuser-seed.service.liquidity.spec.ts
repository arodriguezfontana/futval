import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PasswordHasher } from '../../adapters/auth/password-hasher';
import { FixedClock, SequentialIdGenerator } from '../../adapters/runtime/fake-runtime';
import { UserRepository } from '../../repositories/auth/user.repository';
import { OrderRepository } from '../../repositories/orders/order.repository';
import { TokenTransactionRepository } from '../../repositories/orders/token-transaction.repository';
import { PlayerRepository } from '../../repositories/player/player.repository';
import { TokenHoldingRepository } from '../../repositories/portfolio/token-holding.repository';
import { TransactionManager } from '../../repositories/shared/transaction-manager';
import { QuotationService } from '../quotation/quotation.service';
import { StrategyProvisioningService } from '../quotation/strategy-provisioning.service';
import { SuperuserSeedService } from './superuser-seed.service';

/** 020: cada jugador del catálogo recibe su emisión de 100 tokens una sola vez, aunque se haya sumado después. */
describe('SuperuserSeedService: liquidez por jugador', () => {
  let holdings: { findByUserId: jest.Mock; saveInTransaction: jest.Mock };
  let orders: { saveInTransaction: jest.Mock };

  const run = (catalog: string[], alreadyHeld: Array<{ playerId: string; quantity: number }>) => {
    holdings = { findByUserId: jest.fn().mockResolvedValue(alreadyHeld), saveInTransaction: jest.fn() };
    orders = { saveInTransaction: jest.fn() };
    const env: Record<string, string> = { SUPERUSER_EMAIL: 'superuser@desapp.com', SUPERUSER_PASSWORD: 'Superuser1!' };
    return new SuperuserSeedService(
      { findByEmail: jest.fn().mockResolvedValue({ id: 'su' }) } as unknown as UserRepository,
      {} as PasswordHasher,
      { findAllActive: jest.fn().mockResolvedValue(catalog.map((id) => ({ id }))) } as unknown as PlayerRepository,
      orders as unknown as OrderRepository,
      holdings as unknown as TokenHoldingRepository,
      { saveInTransaction: jest.fn() } as unknown as TokenTransactionRepository,
      { run: (work: (tx: unknown) => unknown) => work({}) } as unknown as TransactionManager,
      { get: (key: string) => env[key] } as unknown as ConfigService,
      {} as StrategyProvisioningService,
      { valuate: jest.fn().mockResolvedValue({ value: 10 }) } as unknown as QuotationService,
      new FixedClock(),
      new SequentialIdGenerator('id'),
    ).run();
  };

  const emittedTo = () => holdings.saveInTransaction.mock.calls.map(([, holding]) => [holding.playerId, holding.quantity]);

  beforeEach(() => jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('si el primer jugador ya tiene tenencia, igual emite 100 tokens a los que faltan', async () => {
    await run(['p1', 'p2', 'p3'], [{ playerId: 'p1', quantity: 100 }]);

    expect(emittedTo()).toEqual([
      ['p2', 100],
      ['p3', 100],
    ]);
    expect(orders.saveInTransaction).toHaveBeenCalledTimes(2);
  });

  it('no vuelve a emitir a un jugador cuyos tokens ya vendió todos', async () => {
    await run(['p1'], [{ playerId: 'p1', quantity: 0 }]);

    expect(holdings.saveInTransaction).not.toHaveBeenCalled();
    expect(orders.saveInTransaction).not.toHaveBeenCalled();
  });
});
