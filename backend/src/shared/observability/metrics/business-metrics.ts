/**
 * Métricas de negocio (spec 031): nombres, conjuntos cerrados de etiquetas, buckets, textos de ayuda y la
 * interfaz que consumen los services. Sin imports de `prom-client` ni del dominio: la implementación vive
 * en `services/observability/business-metrics.service.ts`.
 *
 * Todo valor de etiqueta sale de uno de los conjuntos cerrados de abajo y nunca identifica a un usuario, un
 * jugador, una orden, una alerta ni una corrida puntual.
 */

// ---- Conjuntos cerrados de etiquetas ---------------------------------------------------------------

export const SIDES = ['buy', 'sell'] as const;
export type MetricSide = (typeof SIDES)[number];

/**
 * Catálogo cerrado de operaciones de escritura (los valores de `@AuditedOperation`, más los tres nombres que resuelve
 * `POST /orders` según el cuerpo). Se usa para inicializar en 0 las series de `business_operations_total`; un test
 * verifica que cada `@AuditedOperation` de los controllers esté en esta lista.
 */
export const BUSINESS_OPERATIONS = [
  'TOKENS_BOUGHT',
  'TOKENS_SOLD',
  'ORDER_PLACED',
  'ORDER_CANCELLED',
  'ALERT_CREATED',
  'ALERT_DELETED',
  'API_KEY_ISSUED',
  'USER_REGISTERED',
  'USER_LOGGED_IN',
  'PLAYER_SYNC_TRIGGERED',
  'FOOTBALL_DATA_SYNC_TRIGGERED',
  'QUOTES_RECALCULATED',
  'MARKET_SIMULATED',
  'NOTIFICATION_READ',
  'NOTIFICATIONS_ALL_READ',
  'STRATEGY_SELECTED',
  'STRATEGY_WEIGHTS_UPDATED',
  'STRATEGY_POSITION_WEIGHTS_UPDATED',
] as const;

/** Resultado de una operación de escritura de la API. */
export const OPERATION_OUTCOMES = ['success', 'rejected', 'unexpected'] as const;
export type OperationOutcome = (typeof OPERATION_OUTCOMES)[number];

import type { SyncSource } from '../../../domain/sync/sync-source';

// La fuente de sync es del dominio (una sola definición); se re-exporta para quien ya importa las métricas.
export { SYNC_SOURCES } from '../../../domain/sync/sync-source';
export type { SyncSource } from '../../../domain/sync/sync-source';

export const NOTIFICATION_DELIVERIES = ['live', 'stored_only'] as const;
export type NotificationDelivery = (typeof NOTIFICATION_DELIVERIES)[number];

// ---- Nombres de las métricas -----------------------------------------------------------------------

export const BUSINESS_METRIC_NAMES = {
  operations: 'business_operations_total',
  tokensTraded: 'market_tokens_traded_total',
  volumeCredits: 'market_volume_credits_total',
  syncLastSuccess: 'sync_last_success_timestamp_seconds',
  quoteLastRecalculation: 'quote_last_recalculation_timestamp_seconds',
  alertsTriggered: 'alerts_triggered_total',
  notificationsCreated: 'notifications_created_total',
  sseConnections: 'sse_connections_active',
} as const;

// ---- Textos de ayuda (HELP) ------------------------------------------------------------------------

export const BUSINESS_METRIC_HELP = {
  operations:
    'Operaciones de escritura de la API por tipo y resultado. success significa operación aceptada: para PLAYER_SYNC_TRIGGERED es corrida aceptada, no corrida terminada (su resultado se ve en GET /sync/whoscored/{runId}).',
  tokensTraded: 'Tokens operados por compra y venta (sólo operaciones registradas)',
  volumeCredits: 'Volumen operado en créditos por compra y venta (sólo operaciones registradas)',
  syncLastSuccess:
    'Momento (segundos Unix) de la última sincronización exitosa de cada fuente; una corrida parcial o fallida no lo modifica',
  quoteLastRecalculation:
    'Momento (segundos Unix) del último recálculo de cotizaciones exitoso, incluida la simulación de mercado; se siembra al arrancar desde la última cotización guardada y vale 0 si todavía no hubo ninguno',
  alertsTriggered: 'Alertas de precio disparadas',
  notificationsCreated: 'Notificaciones creadas, según llegaron en vivo o quedaron sólo guardadas',
  sseConnections: 'Conexiones abiertas del stream de notificaciones en tiempo real',
} as const;

// ---- Interfaz --------------------------------------------------------------------------------------

/**
 * Destino de las mediciones de negocio. Ningún método lanza ni devuelve nada: medir nunca altera el
 * resultado de la operación medida (spec 031, FR-013).
 */
export interface BusinessMetrics {
  /** Cuenta una operación de escritura de la API; `operation` sale del catálogo cerrado de `@AuditedOperation`. */
  recordOperation(operation: string, outcome: OperationOutcome): void;
  /** Suma tokens y volumen en créditos de una operación ya registrada (después del commit). */
  recordTokensTraded(side: MetricSide, tokens: number, credits: number): void;
  /** Fija el momento de la última sincronización exitosa de la fuente. */
  setSyncLastSuccess(source: SyncSource, at: Date): void;
  /** Fija el momento del último recálculo de cotizaciones exitoso. */
  setQuoteLastRecalculation(at: Date): void;
  recordAlertTriggered(): void;
  recordNotificationCreated(delivery: NotificationDelivery): void;
  sseConnectionOpened(): void;
  sseConnectionClosed(): void;
}
