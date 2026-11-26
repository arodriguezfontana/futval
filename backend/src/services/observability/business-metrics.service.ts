import { Injectable } from '@nestjs/common';
import { Counter, Gauge } from 'prom-client';
import {
  BUSINESS_OPERATIONS,
  BUSINESS_METRIC_HELP,
  BUSINESS_METRIC_NAMES,
  BusinessMetrics,
  MetricSide,
  NOTIFICATION_DELIVERIES,
  NotificationDelivery,
  OPERATION_OUTCOMES,
  OperationOutcome,
  SIDES,
  SyncSource,
} from '../../shared/observability/metrics/business-metrics';
import { safely } from '../../shared/observability/metrics/safely';
import { MetricsService } from './metrics.service';

/**
 * Métricas de negocio (spec 031), separadas de las técnicas de la API (spec 029) pero en el mismo
 * `Registry`, para que todo salga en el mismo `GET /metrics`.
 *
 * Cada método es tipado por los conjuntos cerrados de etiquetas (un valor fuera del conjunto no compila)
 * y NUNCA lanza: medir no puede alterar el resultado de la operación medida (FR-013).
 */
@Injectable()
export class BusinessMetricsService implements BusinessMetrics {
  private readonly operations: Counter<'operation' | 'outcome'>;
  private readonly tokensTraded: Counter<'side'>;
  private readonly volumeCredits: Counter<'side'>;
  private readonly syncLastSuccess: Gauge<'source'>;
  private readonly quoteLastRecalculation: Gauge;
  private readonly alertsTriggered: Counter;
  private readonly notificationsCreated: Counter<'delivery'>;
  private readonly sseConnections: Gauge;

  constructor(metrics: MetricsService) {
    const registers = [metrics.registry];
    const names = BUSINESS_METRIC_NAMES;
    const help = BUSINESS_METRIC_HELP;

    this.operations = new Counter({
      name: names.operations,
      help: help.operations,
      labelNames: ['operation', 'outcome'],
      registers,
    });
    this.tokensTraded = new Counter({ name: names.tokensTraded, help: help.tokensTraded, labelNames: ['side'], registers });
    this.volumeCredits = new Counter({ name: names.volumeCredits, help: help.volumeCredits, labelNames: ['side'], registers });
    this.syncLastSuccess = new Gauge({
      name: names.syncLastSuccess,
      help: help.syncLastSuccess,
      labelNames: ['source'],
      registers,
    });
    this.quoteLastRecalculation = new Gauge({
      name: names.quoteLastRecalculation,
      help: help.quoteLastRecalculation,
      registers,
    });
    this.alertsTriggered = new Counter({ name: names.alertsTriggered, help: help.alertsTriggered, registers });
    this.notificationsCreated = new Counter({
      name: names.notificationsCreated,
      help: help.notificationsCreated,
      labelNames: ['delivery'],
      registers,
    });
    this.sseConnections = new Gauge({ name: names.sseConnections, help: help.sseConnections, registers });

    // Sin etiquetas: existen desde el arranque, en 0.
    this.alertsTriggered.inc(0);
    this.sseConnections.set(0);
    this.initializeSeries();
  }

  /**
   * Inicializa en 0 todas las series de los conjuntos cerrados de etiquetas. Prometheus calcula `increase()` y
   * `rate()` entre dos muestras: una serie que nace con el primer evento (ya en 1) no tiene muestra previa y ese primer
   * evento no se cuenta. Con la serie en 0 desde el arranque, el primer evento sí cuenta.
   * No se inicializa `sync_last_success_timestamp_seconds`: sin ninguna corrida exitosa no debe haber un valor.
   */
  private initializeSeries(): void {
    safely(() => {
      for (const operation of BUSINESS_OPERATIONS) {
        for (const outcome of OPERATION_OUTCOMES) this.operations.inc({ operation, outcome }, 0);
      }
      for (const side of SIDES) {
        this.tokensTraded.inc({ side }, 0);
        this.volumeCredits.inc({ side }, 0);
      }
      for (const delivery of NOTIFICATION_DELIVERIES) this.notificationsCreated.inc({ delivery }, 0);
    });
  }

  recordOperation(operation: string, outcome: OperationOutcome): void {
    safely(() => this.operations.inc({ operation, outcome }));
  }

  recordTokensTraded(side: MetricSide, tokens: number, credits: number): void {
    safely(() => {
      this.tokensTraded.inc({ side }, tokens);
      this.volumeCredits.inc({ side }, credits);
    });
  }

  setSyncLastSuccess(source: SyncSource, at: Date): void {
    safely(() => this.syncLastSuccess.set({ source }, at.getTime() / 1000));
  }

  setQuoteLastRecalculation(at: Date): void {
    safely(() => this.quoteLastRecalculation.set(at.getTime() / 1000));
  }

  recordAlertTriggered(): void {
    safely(() => this.alertsTriggered.inc());
  }

  recordNotificationCreated(delivery: NotificationDelivery): void {
    safely(() => this.notificationsCreated.inc({ delivery }));
  }

  sseConnectionOpened(): void {
    safely(() => this.sseConnections.inc());
  }

  sseConnectionClosed(): void {
    safely(() => this.sseConnections.dec());
  }
}
