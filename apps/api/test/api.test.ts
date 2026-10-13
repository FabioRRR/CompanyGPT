import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { InlineQueue, LogMailer, MemoryStore, PostgresStore, createJobHandler, createRuntime, loadConfig, migrate, seed, HashEmbedder, type Runtime, type Store } from '@companygpt/server';
import { buildApp } from '../src/app';
import { fullScenario } from './scenario';

const cfg = loadConfig({ NODE_ENV: 'test', JWT_SECRET: 'test-secret-mit-genug-laenge', PLATFORM_DOMAIN: 'companygpt.test', RATE_LIMIT_PER_MINUTE: '10000' });

async function setup(store: Store) {
  const queue = new InlineQueue();
  const mailer = new LogMailer();
  const embedder = new HashEmbedder();
  queue.setHandler(createJobHandler({ store, embedder, mailer, fetchText: async () => 'Testseite' }));
  const rt: Runtime = createRuntime(cfg, { store, queue, mailer, embedder });
  await seed(store, cfg);
  return { rt, app: await buildApp(rt, cfg, { logger: false }) };
}

describe('API mit In-Memory-Speicher', () => {
  it('vollständiger Ablauf', async () => {
    const { app, rt } = await setup(new MemoryStore());
    await fullScenario(app, rt);
    await app.close();
  });

  it('löst den Kunden über die Subdomain auf', async () => {
    const { app } = await setup(new MemoryStore());
    const res = await app.inject({ method: 'GET', url: '/v1/tenant', headers: { host: 'gantner.companygpt.test' } });
    expect(JSON.parse(res.body).gptName).toBe('GantnerGPT');
    const none = await app.inject({ method: 'GET', url: '/v1/tenant', headers: { host: 'unbekannt.companygpt.test' } });
    expect(none.statusCode).toBe(404);
    await app.close();
  });
});

const PG = process.env.TEST_DATABASE_URL;

describe.skipIf(!PG)('API mit PostgreSQL + Row-Level Security', () => {
  let store: PostgresStore;

  afterAll(async () => { await store?.close(); });

  it('vollständiger Ablauf gegen echte Datenbank', async () => {
    const admin = new pg.Client({ connectionString: PG });
    await admin.connect();
    await admin.query('DROP OWNED BY CURRENT_USER CASCADE');
    await admin.end();
    await migrate(PG!, () => {});
    store = new PostgresStore(PG!);
    const { app, rt } = await setup(store);
    await fullScenario(app, rt);
    await app.close();
  });

  it('RLS: ohne Mandanten-Kontext sind Kundendaten unsichtbar', async () => {
    const c = await store.pool.connect();
    try {
      const raw = await c.query('SELECT count(*)::int AS n FROM members');
      expect(raw.rows[0].n).toBe(0);
      const tenants = (await c.query('SELECT id, slug FROM tenants')).rows;
      const gantner = tenants.find((t) => t.slug === 'gantner');
      const other = tenants.find((t) => t.slug !== 'gantner');
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [gantner.id]);
      const scoped = await c.query('SELECT DISTINCT tenant_id FROM members');
      expect(scoped.rows.map((r) => r.tenant_id)).toEqual([gantner.id]);
      // Schreiben in fremde Mandanten wird blockiert
      await expect(c.query(`INSERT INTO members (tenant_id, email, name, role) VALUES ($1, 'x@y.de', 'X', 'member')`, [other.id])).rejects.toThrow(/row-level security/);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});
