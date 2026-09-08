import 'reflect-metadata';
import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import Redis from 'ioredis';
import { AppModule } from './app.module';
import { ProblemJsonFilter } from './common/problem-json.filter';
import { parseAllowedOrigins } from './auth/refresh-cookie';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap(): Promise<void> {
  // rawBody:true captures the unparsed request body (on req.rawBody) so the Stripe webhook can verify
  // the signature against the exact bytes (Increment 12). All other routes still receive parsed JSON.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.enableShutdownHooks();

  // Parse the Cookie header into req.cookies so the web console's httpOnly refresh cookie (Increment —
  // Task 5) is readable on /v1/auth/{refresh,logout}. Native apps send no such cookie; this is inert for them.
  app.use(cookieParser());

  // Socket.IO realtime gateway (Increment 6) with the Redis adapter — emits/disconnects fan
  // out cluster-wide (PRD §10.4). Dedicated pub/sub connections, reusing the same Redis.
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  // REDIS_FAMILY lets a host force the DNS address family for ioredis (Railway's private network is
  // IPv6-only → set REDIS_FAMILY=0 for dual-stack; unset preserves ioredis's local default). See
  // docs/DEPLOY-RAILWAY.md. Increment 14b.
  const redisFamily = process.env.REDIS_FAMILY;
  const redisExtra = redisFamily !== undefined ? { family: Number(redisFamily) } : {};
  const pubClient = new Redis(redisUrl, { maxRetriesPerRequest: null, ...redisExtra });
  const subClient = pubClient.duplicate();
  app.useWebSocketAdapter(new RedisIoAdapter(app, pubClient, subClient));
  // Close the adapter's dedicated pub/sub connections on graceful shutdown (no leaked
  // sockets / unclean SIGTERM). enableShutdownHooks() above drives this via beforeExit.
  process.on('beforeExit', () => {
    void pubClient.quit().catch(() => undefined);
    void subClient.quit().catch(() => undefined);
  });

  // Behind a load balancer/proxy, set TRUST_PROXY (e.g. "1") so req.ip is the real
  // client IP (used for per-IP OTP rate limiting) and not spoofable. Off by default (local dev).
  if (process.env.TRUST_PROXY) {
    const v = process.env.TRUST_PROXY;
    app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v);
  }

  // CORS (Increment 14b — productionize). The browser console (apps/web) and customer web call the
  // API cross-origin, so the deployed origins must be allow-listed. Comma-separated in
  // CORS_ALLOWED_ORIGINS; if unset, CORS stays off (same-origin only — the safe local-dev default).
  // Native apps (Expo customer/owner/driver) issue non-browser requests and are NOT subject to CORS.
  // Shared parser (auth/refresh-cookie) so the CORS allow-list and the controller's cookie-CSRF Origin
  // allow-list are ALWAYS the same set — they can never drift.
  const corsOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
  if (corsOrigins.length > 0) {
    // A wildcard origin and credentials are mutually exclusive per the CORS spec (a browser rejects
    // `Access-Control-Allow-Origin: *` on a credentialed request), so only enable credentials for an
    // explicit origin allow-list. The deployed console uses explicit origins → credentials on.
    const allowAll = corsOrigins.includes('*');
    app.enableCors({
      origin: allowAll ? true : corsOrigins,
      credentials: !allowAll,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    });
    new Logger('Bootstrap').log(`CORS enabled for: ${corsOrigins.join(', ')}`);
  }

  // /v1 URI versioning (PRD §11.1). Routes resolve as /v1/<path>.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // RFC 7807 problem+json for every error (PRD §11.1).
  app.useGlobalFilters(new ProblemJsonFilter());

  // OpenAPI published for app teams (PRD §11.1) at /v1/docs (+ JSON at /v1/docs-json).
  const config = new DocumentBuilder()
    .setTitle('Blue Bee API')
    .setDescription(
      'Commercial laundry & specialty-cleaning operating system — Phase 1 (specialty anchor). See docs/laundry-platform-PRD.md §11.',
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('v1/docs', app, document, { jsonDocumentUrl: 'v1/docs-json' });

  // Railway (and most PaaS) inject the bound port as PORT; honour it first, then the app's own
  // API_PORT, then the local default. Bind 0.0.0.0 so the platform proxy can reach the container.
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(
    `Blue Bee API listening on 0.0.0.0:${port}/v1 (health: /v1/health · docs: /v1/docs)`,
  );
}

void bootstrap();
