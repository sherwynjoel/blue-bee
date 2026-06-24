import { INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { ProblemJsonFilter } from '../src/common/problem-json.filter';

/** Boots the full app exactly as main.ts does (URI /v1 versioning + problem+json + OpenAPI). */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new ProblemJsonFilter());
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('Blue Bee API').setVersion('1.0').addBearerAuth().build(),
  );
  SwaggerModule.setup('v1/docs', app, doc, { jsonDocumentUrl: 'v1/docs-json' });
  await app.init();
  return app;
}

/** Decode a JWT payload without verifying (for asserting claims in tests). */
export function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}
