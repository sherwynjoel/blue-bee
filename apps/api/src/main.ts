import 'reflect-metadata';
import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ProblemJsonFilter } from './common/problem-json.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableShutdownHooks();

  // Behind a load balancer/proxy, set TRUST_PROXY (e.g. "1") so req.ip is the real
  // client IP (used for per-IP OTP rate limiting) and not spoofable. Off by default (local dev).
  if (process.env.TRUST_PROXY) {
    const v = process.env.TRUST_PROXY;
    app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v);
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

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(
    `Blue Bee API listening on http://localhost:${port}/v1 (health: /v1/health · docs: /v1/docs)`,
  );
}

void bootstrap();
