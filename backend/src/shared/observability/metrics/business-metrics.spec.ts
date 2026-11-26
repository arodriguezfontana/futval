import { NOTIFICATION_DELIVERIES, OPERATION_OUTCOMES, SIDES, SYNC_SOURCES } from './business-metrics';

describe('conjuntos cerrados de etiquetas', () => {
  it('contienen exactamente los valores de la spec 031', () => {
    expect([...SIDES]).toEqual(['buy', 'sell']);
    expect([...OPERATION_OUTCOMES]).toEqual(['success', 'rejected', 'unexpected']);
    expect([...SYNC_SOURCES]).toEqual(['whoscored', 'football_data']);
    expect([...NOTIFICATION_DELIVERIES]).toEqual(['live', 'stored_only']);
  });
});
