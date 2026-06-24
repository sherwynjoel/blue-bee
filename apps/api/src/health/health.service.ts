import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { ComponentHealth } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

/**
 * Real liveness checks — actually round-trips Postgres (`SELECT 1`) and Redis
 * (`PING`). Nothing here is hardcoded; the status reflects live connectivity.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async runChecks(): Promise<ComponentHealth[]> {
    return Promise.all([this.checkDatabase(), this.checkRedis()]);
  }

  private async checkDatabase(): Promise<ComponentHealth> {
    const start = Date.now();
    try {
      // Real query against Postgres; also confirm PostGIS + TimescaleDB are present.
      const rows = await this.prisma.$queryRaw<Array<{ postgis: string | null; timescaledb: string | null }>>`
        SELECT
          (SELECT extversion FROM pg_extension WHERE extname = 'postgis')     AS postgis,
          (SELECT extversion FROM pg_extension WHERE extname = 'timescaledb') AS timescaledb
      `;
      const ext = rows[0] ?? { postgis: null, timescaledb: null };
      return {
        name: 'database',
        status: 'up',
        latencyMs: Date.now() - start,
        detail: `postgis=${ext.postgis ?? 'missing'} timescaledb=${ext.timescaledb ?? 'missing'}`,
      };
    } catch (err) {
      return {
        name: 'database',
        status: 'down',
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async checkRedis(): Promise<ComponentHealth> {
    const start = Date.now();
    try {
      const pong = await this.redis.ping();
      return {
        name: 'redis',
        status: pong === 'PONG' ? 'up' : 'down',
        latencyMs: Date.now() - start,
        detail: `PING -> ${pong}`,
      };
    } catch (err) {
      return {
        name: 'redis',
        status: 'down',
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
