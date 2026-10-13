import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import IORedis from 'ioredis';
import type { Config, Runtime } from '@companygpt/server';
import { Tokens, errorHandler, makeGuards, tenantSlug, bearer } from './http';
import { publicRoutes } from './routes/public';
import { tenantRoutes } from './routes/tenant';
import { platformRoutes } from './routes/platform';

export interface Deps {
  rt: Runtime;
  cfg: Config;
  tokens: Tokens;
  guards: ReturnType<typeof makeGuards>;
}

/**
 * Zustandslose API: jede Instanz ist austauschbar und kann horizontal skaliert werden.
 * Sitzungen stecken im JWT, Daten in Postgres, Jobs in Redis.
 */
export async function buildApp(rt: Runtime, cfg: Config, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? cfg.NODE_ENV !== 'test', trustProxy: true, bodyLimit: 2 * 1024 * 1024 });
  const tokens = new Tokens(cfg.JWT_SECRET);
  const guards = makeGuards(rt, tokens, cfg.PLATFORM_DOMAIN);
  const deps: Deps = { rt, cfg, tokens, guards };

  app.setErrorHandler(errorHandler);
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  // Fair Use pro Kunde und Person. Mit Redis gilt das Limit über alle API-Instanzen hinweg.
  await app.register(rateLimit, {
    max: cfg.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    ...(cfg.REDIS_URL ? { redis: new IORedis(cfg.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false }) } : {}),
    keyGenerator: async (req) => {
      const claims = await bearer(req, tokens);
      const scope = tenantSlug(req, cfg.PLATFORM_DOMAIN) ?? 'platform';
      return `${scope}:${claims?.sub ?? req.ip}`;
    },
    allowList: (req) => req.url === '/health' || req.url === '/ready'
  });

  app.get('/health', async () => ({ ok: true }));
  app.get('/ready', async (_req, reply) => {
    try {
      await rt.store.latestTemplate();
      return { ok: true };
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });

  await publicRoutes(app, deps);
  await tenantRoutes(app, deps);
  await platformRoutes(app, deps);
  return app;
}
