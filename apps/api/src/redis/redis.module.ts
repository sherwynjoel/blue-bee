import { Global, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import Redis from 'ioredis';

/** DI token for the shared ioredis client (live last-known location, cache, queues — PRD §10). */
export const REDIS = Symbol('REDIS_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: (): Redis => {
        const logger = new Logger('RedisModule');
        const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
          maxRetriesPerRequest: 2,
          lazyConnect: false,
        });
        client.on('error', (err) => logger.warn(`Redis error: ${err.message}`));
        client.on('connect', () => logger.log('Redis connected'));
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(private readonly moduleRef: ModuleRef) {}

  async onApplicationShutdown(): Promise<void> {
    const client = this.moduleRef.get<Redis>(REDIS, { strict: false });
    if (client) {
      await client.quit().catch(() => undefined);
    }
  }
}
