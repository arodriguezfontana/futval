import { Registry } from 'prom-client';
import { BusinessMetricsService } from './business-metrics.service';
import { MetricsService } from './metrics.service';

describe('BusinessMetricsService', () => {
  let metrics: MetricsService;
  let business: BusinessMetricsService;

  beforeEach(() => {
    metrics = new MetricsService();
    business = new BusinessMetricsService(metrics);
  });

  const text = () => metrics.render();

  it('comparte el Registry con MetricsService: todo sale en el mismo render()', async () => {
    const out = await text();
    expect(out).toContain('http_requests_total');
    expect(out).toContain('business_operations_total');
    expect(out).toContain('sse_connections_active 0');
    expect(out).toContain('alerts_triggered_total 0');
  });

  it('recordOperation cuenta por operación y resultado', async () => {
    business.recordOperation('TOKENS_BOUGHT', 'success');
    business.recordOperation('TOKENS_BOUGHT', 'success');
    business.recordOperation('TOKENS_SOLD', 'rejected');
    const out = await text();
    expect(out).toContain('business_operations_total{operation="TOKENS_BOUGHT",outcome="success"} 2');
    expect(out).toContain('business_operations_total{operation="TOKENS_SOLD",outcome="rejected"} 1');
  });

  it('recordTokensTraded suma tokens y volumen por lado', async () => {
    business.recordTokensTraded('buy', 3, 150.5);
    business.recordTokensTraded('buy', 2, 20);
    business.recordTokensTraded('sell', 1, 10);
    const out = await text();
    expect(out).toContain('market_tokens_traded_total{side="buy"} 5');
    expect(out).toContain('market_volume_credits_total{side="buy"} 170.5');
    expect(out).toContain('market_tokens_traded_total{side="sell"} 1');
  });

  it('setSyncLastSuccess fija el gauge en segundos Unix y no existe antes', async () => {
    expect(await text()).not.toContain('sync_last_success_timestamp_seconds{');
    business.setSyncLastSuccess('football_data', new Date('2026-11-13T10:00:00.000Z'));
    expect(await text()).toContain(
      `sync_last_success_timestamp_seconds{source="football_data"} ${Date.parse('2026-11-13T10:00:00.000Z') / 1000}`,
    );
  });

  it('alertas, notificaciones por entrega y conexiones SSE', async () => {
    business.recordAlertTriggered();
    business.recordNotificationCreated('live');
    business.recordNotificationCreated('stored_only');
    business.recordNotificationCreated('stored_only');
    business.sseConnectionOpened();
    business.sseConnectionOpened();
    business.sseConnectionClosed();
    const out = await text();
    expect(out).toContain('alerts_triggered_total 1');
    expect(out).toContain('notifications_created_total{delivery="live"} 1');
    expect(out).toContain('notifications_created_total{delivery="stored_only"} 2');
    expect(out).toContain('sse_connections_active 1');
  });

  it('el HELP de business_operations_total lleva la aclaración', async () => {
    const out = await text();
    expect(out).toMatch(/# HELP business_operations_total .*corrida aceptada, no corrida terminada/);
  });

  describe('nunca lanza', () => {
    it('ante un fallo interno de prom-client (valores inválidos) se ignora', () => {
      expect(() => business.recordTokensTraded('buy', -1, -1)).not.toThrow();
    });

    it('con un Registry roto ningún método lanza', () => {
      const brokenRegistry = new Registry();
      const broken = new BusinessMetricsService({ registry: brokenRegistry } as unknown as MetricsService);
      brokenRegistry.clear();
      brokenRegistry.registerMetric = () => {
        throw new Error('roto');
      };
      expect(() => {
        broken.recordOperation('X', 'success');
        broken.recordTokensTraded('sell', 1, 1);
        broken.setSyncLastSuccess('whoscored', new Date());
        broken.recordAlertTriggered();
        broken.recordNotificationCreated('live');
        broken.sseConnectionOpened();
        broken.sseConnectionClosed();
      }).not.toThrow();
    });
  });
});
