import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Player, PlayerSnapshot } from '../../domain/player/player';
import { PlayerFilters } from '../../domain/player/player-filters';
import { PlayerPagination } from '../../domain/player/player-page';
import { TeamRepository } from '../../repositories/competition/team.repository';
import { RedisCacheService } from '../../shared/cache/redis-cache.service';
import { buildCacheKey, buildUserRankingCacheKey } from '../../domain/cache/build-cache-key';
import { PlayerService } from './player.service';

export interface PlayerWithCrest {
  player: Player;
  crestUrl: string | null;
}

export interface PlayerPageWithCrests {
  items: PlayerWithCrest[];
  total: number;
}

/** Item del ranking enriquecido con el escudo y la posición ordinal (rank 1..N). */
export interface RankedPlayerWithCrest {
  player: Player;
  crestUrl: string | null;
  rank: number;
  valor: number;
  score: number;
  strategyName: string;
  calculatedAt: Date;
}

export interface PlayerRankingPageWithCrests {
  items: RankedPlayerWithCrest[];
  total: number;
}

/**
 * Forma de lo que se guarda en Redis: igual que la respuesta, pero con el jugador como snapshot de datos (no como clase) y
 * las fechas como texto. Un `Player` serializado con `JSON.stringify` perdería sus getters.
 */
type Cached<T extends { player: Player }> = Omit<T, 'player' | 'calculatedAt'> & {
  player: PlayerSnapshot;
  calculatedAt?: string;
};

@Injectable()
export class PlayerEnrichmentService {
  constructor(
    private readonly playerService: PlayerService,
    private readonly teams: TeamRepository,
    @Optional() private readonly cache?: RedisCacheService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  async listPlayersWithCrests(
    filters: PlayerFilters,
    pagination: PlayerPagination,
  ): Promise<PlayerPageWithCrests> {
    const cacheKey = buildCacheKey('catalog', { ...filters, ...pagination });
    if (this.cache) {
      const cached = await this.readCache<{ items: Array<Cached<PlayerWithCrest>>; total: number }>(cacheKey);
      if (cached) {
        return { ...cached, items: cached.items.map((item) => ({ ...item, player: Player.restore(item.player) })) };
      }
    }

    const page = await this.playerService.listPlayers(filters, pagination);
    const crests = await this.loadCrests(page.items);
    const items = page.items.map((player) => ({
      player,
      crestUrl: crests.get(player.team) ?? null,
    }));
    const result: PlayerPageWithCrests = { items, total: page.total };

    if (this.cache) {
      const ttl = Number(this.configService?.get<number>('REDIS_TTL_CATALOG', 3600)) || 3600;
      const payload = { total: result.total, items: result.items.map((item) => ({ ...item, player: item.player.toSnapshot() })) };
      await this.cache.set(cacheKey, payload, ttl);
    }
    return result;
  }

  async getRankingWithCrests(
    userId: string,
    filters: PlayerFilters,
    pagination: PlayerPagination,
  ): Promise<PlayerRankingPageWithCrests> {
    const cacheKey = buildUserRankingCacheKey(userId, { ...filters, ...pagination });
    if (this.cache) {
      const cached = await this.readCache<{ items: Array<Cached<RankedPlayerWithCrest>>; total: number }>(cacheKey);
      if (cached) {
        return {
          ...cached,
          items: cached.items.map((item) => ({
            ...item,
            player: Player.restore(item.player),
            calculatedAt: new Date(item.calculatedAt as string),
          })),
        };
      }
    }

    const page = await this.playerService.findRanking(userId, filters, pagination);
    const crests = await this.loadCrests(page.items.map((item) => item.player));
    const items = page.items.map((item, index) => ({
      player: item.player,
      crestUrl: crests.get(item.player.team) ?? null,
      rank: (pagination.page - 1) * pagination.pageSize + index + 1,
      valor: item.valor,
      score: item.score,
      strategyName: item.strategyName,
      calculatedAt: item.calculatedAt,
    }));
    const result: PlayerRankingPageWithCrests = { items, total: page.total };

    if (this.cache) {
      const ttl = Number(this.configService?.get<number>('REDIS_TTL_RANKING', 86400)) || 86400;
      const payload = { total: result.total, items: result.items.map((item) => ({ ...item, player: item.player.toSnapshot() })) };
      await this.cache.set(cacheKey, payload, ttl);
    }
    return result;
  }

  async getPlayerByIdWithCrest(id: string): Promise<PlayerWithCrest> {
    const cacheKey = `futval:player:${id}`;
    if (this.cache) {
      const cached = await this.readCache<Cached<PlayerWithCrest>>(cacheKey);
      if (cached) {
        return { ...cached, player: Player.restore(cached.player) };
      }
    }

    const player = await this.playerService.getPlayerById(id);
    const crests = await this.loadCrests([player]);
    const result: PlayerWithCrest = { player, crestUrl: crests.get(player.team) ?? null };

    if (this.cache) {
      const ttl = Number(this.configService?.get<number>('REDIS_TTL_CATALOG', 3600)) || 3600;
      await this.cache.set(cacheKey, { ...result, player: player.toSnapshot() }, ttl);
    }
    return result;
  }

  /** Lectura del cache fail-open: si Redis o su servicio fallan, se resuelve como si no hubiera cache (acierto perdido, no error). */
  private async readCache<T>(key: string): Promise<T | null> {
    try {
      return (await this.cache?.get<T>(key)) ?? null;
    } catch {
      return null;
    }
  }

  /** Una sola consulta a `teams` por los equipos distintos de los jugadores: nombre WhoScored → escudo. */
  private async loadCrests(players: Player[]): Promise<Map<string, string | null>> {
    const teamNames = [...new Set(players.map((player) => player.team))];
    if (teamNames.length === 0) return new Map();
    const found = await this.teams.findByWhoScoredNames(teamNames);
    return new Map(found.map((team) => [team.whoScoredName, team.crestUrl]));
  }
}
