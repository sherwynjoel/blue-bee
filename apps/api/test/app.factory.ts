import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import Redis from 'ioredis';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module';
import { ProblemJsonFilter } from '../src/common/problem-json.filter';
import { RedisIoAdapter } from '../src/realtime/redis-io.adapter';

function configure(app: INestApplication): void {
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // Mirror main.ts: parse cookies so the httpOnly refresh cookie is readable in e2e (Task 5).
  app.use(cookieParser());
  app.useGlobalFilters(new ProblemJsonFilter());
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Blue Bee API').setVersion('1.0').addBearerAuth().build(),
  );
  SwaggerModule.setup('v1/docs', app, doc, { jsonDocumentUrl: 'v1/docs-json' });
}

/** One provider swap: `{ token, useValue }`, applied before the testing module compiles. */
export interface ProviderOverride {
  token: unknown;
  useValue: unknown;
}

/**
 * Boots the full app exactly as main.ts does (URI /v1 versioning + problem+json + OpenAPI).
 *
 * `overrides` swaps DI tokens for test doubles. Its reason for existing is the geocoder: `POST /v1/sites`
 * resolves an address through `GEOCODER_PROVIDER`, whose real implementation calls OpenStreetMap over the
 * network. An e2e that hit OSM would be slow, rate-limited, and offline-flaky — so the sites spec injects a
 * deterministic fake. Every OTHER seam (Postgres, PostGIS, Redis, row-scoping) stays real.
 */
export async function createTestApp(overrides: ProviderOverride[] = []): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  for (const o of overrides) {
    builder = builder.overrideProvider(o.token).useValue(o.useValue);
  }
  const moduleRef = await builder.compile();
  // rawBody:true mirrors main.ts so the Stripe webhook e2e verifies signatures against the raw body.
  const app = moduleRef.createNestApplication({ rawBody: true });
  configure(app);
  await app.init();
  return app;
}

/**
 * Boots the app with the REAL Redis Socket.IO adapter and a listening port, so a real
 * `socket.io-client` can connect (Increment 6 WS e2e). Returns the bound port + the pub/sub
 * Redis clients so the spec can close them (no open handles). `app.close()` tears down the WS
 * server; the spec must also `quit()` the returned clients.
 */
export async function createRealtimeTestApp(): Promise<{
  app: INestApplication;
  port: number;
  pub: Redis;
  sub: Redis;
}> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configure(app);
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const pub = new Redis(url, { maxRetriesPerRequest: null });
  const sub = pub.duplicate();
  app.useWebSocketAdapter(new RedisIoAdapter(app, pub, sub));
  await app.listen(0);
  const port = (app.getHttpServer().address() as AddressInfo).port;
  return { app, port, pub, sub };
}

/** Decode a JWT payload without verifying (for asserting claims in tests). */
export function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}
