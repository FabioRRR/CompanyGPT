import { createRuntime, loadConfig, migrate, MemoryStore, seed } from '@companygpt/server';
import { buildApp } from './app';

const cfg = loadConfig();
const rt = createRuntime(cfg);

if (cfg.DATABASE_URL && cfg.NODE_ENV !== 'production') await migrate(cfg.DATABASE_URL);
if (rt.store instanceof MemoryStore || cfg.NODE_ENV !== 'production') await seed(rt.store, cfg);

const app = await buildApp(rt, cfg);
await app.listen({ port: cfg.PORT, host: '0.0.0.0' });

// Sauber herunterfahren, damit laufende Anfragen beim Skalieren/Deployen nicht abbrechen
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    await app.close();
    await rt.close();
    process.exit(0);
  });
}
