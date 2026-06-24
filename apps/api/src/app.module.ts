import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { SmsModule } from './auth/sms/sms.module';
import { AuthModule } from './auth/auth.module';
import { OrdersModule } from './orders/orders.module';

/**
 * Root module of the Blue Bee modular monolith (PRD §10.3). Phase-1 wires config +
 * the Postgres/Redis infrastructure + health + auth (Increment 2) + orders
 * (Increment 3 — specialty book→intake→quote→approve). Routes/tracking/billing
 * modules land in later increments.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    SmsModule,
    AuthModule,
    OrdersModule,
    HealthModule,
  ],
})
export class AppModule {}
