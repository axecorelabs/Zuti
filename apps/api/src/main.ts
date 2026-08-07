import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser = require('cookie-parser');

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Respect X-Forwarded-For when running behind a proxy/load balancer.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Needed to read the httpOnly refresh-token cookie (see auth.controller.ts).
  app.use(cookieParser());

  const isProduction = process.env.NODE_ENV === 'production';

  const shouldEnableSwagger =
    process.env.ENABLE_SWAGGER === 'true'
    || process.env.NODE_ENV !== 'production';

  // This is a JSON API consumed cross-origin by three separate frontends (web, tixtron-web, admin)
  // plus the public widget — crossOriginResourcePolicy must stay 'cross-origin' or those fetches
  // break. CSP is skipped entirely when Swagger UI is enabled (dev/staging only — its bundled JS
  // needs inline scripts/styles); in production (Swagger off) a strict default-src 'self' applies,
  // which mainly protects the rare HTML error page rather than the JSON responses themselves.
  app.use(
    helmet({
      contentSecurityPolicy: shouldEnableSwagger
        ? false
        : {
            directives: {
              defaultSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
            },
          },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = new Set<string>([
    'https://zuti.bords.app',
    'https://zuti-admin.vercel.app',
    ...(!isProduction ? [
      'http://localhost:3000',
      'http://localhost:3002',
      'http://localhost:3003',
      'http://localhost:3004', // Tixtron (apps/tixtron-web) local dev
    ] : []),
    ...configuredOrigins,
  ]);

  const configuredWidgetOrigins = (process.env.WIDGET_ALLOWED_ORIGINS ?? '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const widgetOriginsAllowAll = configuredWidgetOrigins.includes('*');
  const allowedWidgetOrigins = new Set<string>(configuredWidgetOrigins.filter((origin) => origin !== '*'));

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const isWidgetRoute = req.path.startsWith('/api/bots/widget/message/');

    // Non-browser clients (no Origin) should continue to work.
    if (!origin) {
      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }
      return next();
    }

    if (isWidgetRoute) {
      const widgetOriginAllowed = widgetOriginsAllowAll || allowedWidgetOrigins.has(origin);
      if (!widgetOriginAllowed) {
        return res.status(403).send('Not allowed by CORS');
      }

      // Widget route stays public and does not use cookie credentials.
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Requested-With');

      if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
      }
      return next();
    }

    if (!allowedOrigins.has(origin)) {
      return res.status(403).send('Not allowed by CORS');
    }

    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    return next();
  });

  if (shouldEnableSwagger) {
    const config = new DocumentBuilder()
      .setTitle('Zuti API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(process.env.PORT ?? 3001);
}

bootstrap();
