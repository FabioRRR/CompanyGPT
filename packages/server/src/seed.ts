import { fileURLToPath } from 'node:url';
import { DEFAULT_COLLECTIONS } from '@companygpt/core';
import { loadConfig, type Config } from './config';
import { hashPassword } from './infra';
import { createRuntime } from './runtime';
import type { Store } from './store/types';

/**
 * Legt die Grunddaten an: Vorlage, Plattform-Zugang und den Beispielkunden Gantner.
 * Idempotent – mehrfaches Ausführen ändert nichts.
 */
export async function seed(store: Store, cfg: Pick<Config, 'PLATFORM_ADMIN_EMAIL' | 'PLATFORM_ADMIN_PASSWORD'>) {
  const versions = await store.listTemplates().catch(() => []);
  if (!versions.some((v) => v.version === '1.4')) await store.publishTemplate('1.4', ['Wissen verwalten', 'App-Katalog', 'Sicherheitsbewertung']).catch(() => {});
  if (!(await store.findPlatformUser(cfg.PLATFORM_ADMIN_EMAIL))) {
    await store.createPlatformUser(cfg.PLATFORM_ADMIN_EMAIL, 'CompanyGPT-Team', await hashPassword(cfg.PLATFORM_ADMIN_PASSWORD));
  }
  let gantner = await store.getTenantBySlug('gantner');
  if (!gantner) {
    gantner = await store.createTenant({
      slug: 'gantner', company: 'Gantner Instruments', gptName: 'GantnerGPT', templateVersion: (await store.latestTemplate()).version,
      brand: { primary: '#0040C4' },
      collections: DEFAULT_COLLECTIONS.map((c) => ({ ...c, gptEnabled: c.key !== 'mgmt' }))
    });
    await store.updateTenant(gantner.id, { status: 'active' });
    const pw = await hashPassword('demo1234');
    await store.createMember(gantner.id, { name: 'ADMIN', email: 'admin@gantner-instruments.com', role: 'admin', passwordHash: pw });
    await store.createMember(gantner.id, { name: 'USER001', email: 'user001@gantner-instruments.com', role: 'member', passwordHash: pw });
  }
  return gantner;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cfg = loadConfig();
  const rt = createRuntime(cfg);
  seed(rt.store, cfg).then(async () => { console.log('Seed fertig'); await rt.close(); process.exit(0); }, (e) => { console.error(e); process.exit(1); });
}
