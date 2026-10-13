import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(8080),
  DATABASE_URL: z.string().optional(),
  DATABASE_POOL_SIZE: z.coerce.number().default(10),
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16).default('dev-secret-bitte-in-produktion-ersetzen'),
  PLATFORM_DOMAIN: z.string().default('companygpt.local'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(120),
  WORKER_CONCURRENCY: z.coerce.number().default(10),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('claude-sonnet-5-5'),
  EMBEDDINGS_URL: z.string().optional(),
  EMBEDDINGS_API_KEY: z.string().optional(),
  EMBEDDINGS_MODEL: z.string().optional(),
  PLATFORM_ADMIN_EMAIL: z.string().default('du@companygpt.demo'),
  PLATFORM_ADMIN_PASSWORD: z.string().default('demo1234')
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const cfg = schema.parse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')));
  if (cfg.NODE_ENV === 'production') {
    if (!cfg.DATABASE_URL) throw new Error('DATABASE_URL ist in Produktion Pflicht');
    if (!cfg.REDIS_URL) throw new Error('REDIS_URL ist in Produktion Pflicht');
    if (cfg.JWT_SECRET.startsWith('dev-')) throw new Error('JWT_SECRET muss in Produktion gesetzt sein');
  }
  return cfg;
}
