import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { Redis as RedisClient } from 'ioredis';

@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly client: RedisClient | null = null;
  private isConnected = false;

  private destroyed = false;
  private endpoint = '';

  constructor(
    private readonly configService: ConfigService,
    @Optional() injectedClient?: RedisClient,
  ) {
    if (injectedClient) {
      this.client = injectedClient;
      this.isConnected = true;
    } else {
      const host = this.configService.get<string>('REDIS_HOST', 'localhost');
      const port = Number(this.configService.get<number>('REDIS_PORT', 6379));
      const password = this.configService.get<string>('REDIS_PASSWORD');
      this.endpoint = `${host}:${port}`;

      try {
        this.client = new Redis({
          host,
          port,
          password: password || undefined,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          // Reintenta siempre (espera creciente, tope 5 s) para reconectar solo cuando Redis vuelve. Mientras tanto no se
          // encolan comandos (`enableOfflineQueue: false`): cada operación falla enseguida y se atiende sin caché.
          retryStrategy: (times) => (this.destroyed ? null : Math.min(times * 200, 5000)),
        });

        this.client.on('connect', () => {
          this.isConnected = true;
          this.logger.log(`Conectado a Redis en ${host}:${port}`);
        });

        this.client.on('error', (err) => {
          this.isConnected = false;
          this.logger.warn(`Error de conexión con Redis (${host}:${port}): ${err.message}`);
        });

        this.client.on('close', () => {
          this.isConnected = false;
        });
      } catch (err) {
        this.logger.warn(`Fallo al inicializar cliente Redis: ${err instanceof Error ? err.message : String(err)}. Operando en fail-open.`);
        this.client = null;
      }
    }
  }

  /** Conecta al iniciar el módulo, sin esperar la conexión para no demorar el arranque. */
  onModuleInit(): void {
    // `wait` = cliente creado con `lazyConnect` que todavía no intentó conectarse.
    if (this.client?.status !== 'wait') return;
    this.client.connect().catch((err) => {
      this.logger.warn(`No se pudo conectar a Redis al inicio (${this.endpoint}): ${err.message}. Operando en modo fail-open.`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (!this.client) return;
    try {
      // `quit` sólo tiene sentido con la conexión abierta (despide ordenadamente).
      if (this.client.status === 'ready') await this.client.quit();
    } catch {
      // Se corta igual abajo.
    }
    // Siempre: cancela el reintento pendiente. Si no, el proceso (y Jest en CI, sin Redis) no termina nunca.
    this.client.disconnect();
  }

  /**
   * Obtiene y deserializa un elemento de caché en formato JSON.
   * Si la clave no existe o Redis falla (fail-open), retorna null sin arrojar error.
   */
  async get<T = unknown>(key: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn(`Error al leer clave ${key} de Redis: ${err instanceof Error ? err.message : String(err)}. Retornando null (fail-open).`);
      return null;
    }
  }

  /**
   * Serializa y almacena un valor en caché en formato JSON con TTL opcional en segundos.
   * Si Redis falla (fail-open), captura la excepción y no interrumpe el flujo.
   */
  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    if (!this.client) return;
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.set(key, serialized, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, serialized);
      }
    } catch (err) {
      this.logger.warn(`Error al escribir clave ${key} en Redis: ${err instanceof Error ? err.message : String(err)}. Omitiendo escritura (fail-open).`);
    }
  }

  /**
   * Elimina una clave puntual de caché.
   */
  async del(key: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.warn(`Error al borrar clave ${key} en Redis: ${err instanceof Error ? err.message : String(err)}.`);
    }
  }

  /**
   * Invalida todas las claves que coincidan con un prefijo determinado usando scanStream.
   */
  async delByPrefix(prefix: string): Promise<void> {
    if (!this.client) return;
    try {
      const pattern = prefix.endsWith('*') ? prefix : `${prefix}*`;
      const stream = this.client.scanStream({
        match: pattern,
        count: 100,
      });

      const keysToDelete: string[] = [];
      for await (const resultKeys of stream) {
        if (Array.isArray(resultKeys) && resultKeys.length > 0) {
          keysToDelete.push(...resultKeys);
        }
      }

      if (keysToDelete.length > 0) {
        const pipeline = this.client.pipeline();
        for (const k of keysToDelete) {
          pipeline.del(k);
        }
        await pipeline.exec();
        this.logger.debug(`Invalidadas ${keysToDelete.length} claves de Redis con patrón ${pattern}`);
      }
    } catch (err) {
      this.logger.warn(`Error al invalidar claves con prefijo ${prefix} en Redis: ${err instanceof Error ? err.message : String(err)}.`);
    }
  }

  /**
   * Verifica conectividad con Redis mediante PING.
   */
  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      const res = await this.client.ping();
      return res === 'PONG';
    } catch {
      return false;
    }
  }
}
