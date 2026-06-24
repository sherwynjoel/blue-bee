import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Thin NestJS wrapper over the generated PrismaClient. Connects on module init
 * so a failure to reach Postgres surfaces at boot rather than on first query.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected to Postgres');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
