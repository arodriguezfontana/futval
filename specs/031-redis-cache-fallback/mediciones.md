# Mediciones SC-001 y SC-005 — 031-redis-cache-fallback

Medido con `backend/test/e2e/redis-performance.e2e-spec.ts` (no corre en la suite normal):

```bash
docker run -d --rm --name futval-perf-redis -p 6379:6379 redis:7-alpine
cd backend
MEASURE_REDIS_PERF=1 pnpm test:e2e -- redis-performance
```

Datos sintéticos: 20 000 jugadores (2 % dados de baja), 60 000 cotizaciones (3 por jugador) de un usuario. El generador de
carga corre en un proceso de Node aparte; los datos sembrados se borran al terminar. Equipo de desarrollo (Windows, app y
Postgres en la misma máquina), así que los valores sirven para comparar, no como garantía de producción.

## SC-001 — latencia de aciertos de caché

| Endpoint | Miss (1.º pedido) | 1 cliente: p50 / p95 / p99 | 30 clientes: p50 / p95 / p99 | req/s con 30 |
|---|---|---|---|---|
| `GET /health` (referencia, sin caché) | — | 2.3 / 5.1 / 6.0 ms | 39 / 60 / 70 ms | 729 |
| `GET /players` | 21 ms | 4.4 / 7.8 / 11.9 ms | 55 / 79 / 125 ms | 519 |
| `GET /players/:id` | 17 ms | 3.9 / 6.1 / 7.5 ms | 41 / 77 / 108 ms | 652 |
| `GET /players/ranking` | 194 ms | 5.3 / 8.0 / 10.6 ms | 76 / 109 / 133 ms | 387 |

**Lectura honesta**

- Sin contención, un acierto de caché cumple el presupuesto: **p95 entre 6 y 8 ms (≤ 15 ms)**. El ranking pasa de 194 ms
  (miss) a ~5 ms.
- Con **30 clientes en bucle cerrado y sin pausa, el p95 de 15 ms NO se cumple (77–109 ms)**. No lo determina la caché: el
  endpoint de referencia `GET /health`, que no usa caché, da 60 ms de p95 en las mismas condiciones. La app entrega ~400–750
  req/s en este equipo y 30 clientes sin pausa solo hacen cola; para sostener 15 ms de p95 haría falta ≈ 2 000 req/s.
  La latencia en reposo de Redis es 0.5 ms (p50) / 1 ms (p95).
- Cada acierto de `/players` y `/players/:id` todavía hace 2 consultas de autenticación (API key y usuario) a PostgreSQL;
  es el siguiente costo a recortar si se quiere acercar el valor con 30 clientes.
- **Los valores dependen mucho de la carga del equipo.** Una segunda corrida, con la máquina más lenta (`GET /health` 1 cliente
  p95 12 ms, 208 req/s con 30), dio con 1 cliente p95 de 22 / 14 / 22 ms (`/players`, `/players/:id`, ranking): ahí el
  presupuesto de 15 ms **no** se cumplió en dos de los tres endpoints.
- Por eso el test exige `p95 <= max(15 ms, 2 × p95 de GET /health)` con 1 cliente y solo informa el resultado con 30.
  Para validar SC-001 tal como está escrito hay que medir contra un despliegue, en un equipo aparte del generador de carga.

## SC-005 — planes de ejecución en un miss (`EXPLAIN ANALYZE`)

| Consulta | Plan | Tiempo |
|---|---|---|
| `findPage` — total | Index Only Scan `idx_players_removed_league_position` | 0.4 ms |
| `findPage` — página | Index Scan sobre la clave primaria (orden por `id`) | 0.2 ms |
| `findRanking` — total | Seq Scan `players` + Index Only Scan `idx_player_quotes_user_player_calc_desc` | 34–57 ms |
| `findRanking` — página | Seq Scan `players` + Index Scan `idx_player_quotes_user_player_calc_desc` | 86–180 ms |

- El **catálogo cumple**: sin Seq Scan sobre `players`, usa el índice nuevo.
- El **ranking** lee `players` completo porque une todos los jugadores con cotización y no hay filtro que lo reduzca: ahí el
  Seq Scan es el plan correcto, no un defecto. Sí lee las cotizaciones (la tabla grande) por índice. El enunciado de
  SC-005 ("eliminando los Seq Scans") es entonces exacto para `findPage` y no aplica al ranking sin filtros.
- **Corregido:** el índice preexistente `idx_player_quotes_user_player_date` cubría las mismas columnas que el nuevo, y el
  planificador usaba el viejo. La migración `1793200000002-DropDuplicateQuoteIndex` lo elimina (y se quitó la anotación
  `@Index` duplicada de `player-quote.entity.ts`); ahora el ranking usa `idx_player_quotes_user_player_calc_desc` (FR-014).

## Migraciones en la base de desarrollo

`pnpm migration:run` (con `.env` cargado) aplicó `CreateSyncLastSuccess1793200000001` y `DropDuplicateQuoteIndex1793200000002`; los índices
`idx_players_removed_league_position` e `idx_player_quotes_user_player_calc_desc` existen. En la tabla `migrations` queda
además el registro `CreateSyncLastSuccess1793200000000` de la ejecución anterior al renombre (inofensivo: la sentencia es
`IF NOT EXISTS`).
