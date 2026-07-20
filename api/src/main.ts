import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

/**
 * JSON/urlencoded body limit. Uploads (PDFs, pack photos, etc.) go through
 * multer (own limits per-route, up to 25MB) — this only bounds plain JSON
 * bodies (e.g. a saved BOM analysis payload), which are normally well under
 * 1MB but can include several inlined image references.
 */
const JSON_BODY_LIMIT = '15mb';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');

  // gzip/deflate every response above the default 1KB threshold — cuts JSON
  // preview payloads and text responses substantially over the wire.
  app.use(compression());

  // Baseline security headers. CSP and Cross-Origin-Resource-Policy are
  // disabled: this is a pure JSON/asset API (no HTML rendering) consumed
  // cross-origin by the Angular app, and the defaults would otherwise block
  // the browser from loading streamed PNGs/PDFs (elevation maps, pack
  // photos, planning documents) from a different origin/port.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: false,
    }),
  );

  app.use(json({ limit: JSON_BODY_LIMIT }));
  app.use(urlencoded({ limit: JSON_BODY_LIMIT, extended: true }));

  const extra = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: [
      /localhost:\d+$/,
      /127\.0\.0\.1:\d+$/,
      ...extra,
    ],
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`SkyFlow API listening on http://localhost:${port}/api`);
}
bootstrap();
