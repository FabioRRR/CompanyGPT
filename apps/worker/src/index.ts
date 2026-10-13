import { createJobHandler, createRuntime, loadConfig, startWorker } from '@companygpt/server';

/**
 * Hintergrund-Worker: Indexierung, App-Synchronisation, E-Mails, Rollouts.
 * Beliebig viele Instanzen parallel – Redis verteilt die Jobs.
 */
const cfg = loadConfig();
if (!cfg.REDIS_URL) {
  console.error('REDIS_URL fehlt – ohne Redis laufen Jobs direkt in der API.');
  process.exit(1);
}
const rt = createRuntime(cfg);
const handler = createJobHandler({ store: rt.store, embedder: rt.embedder, mailer: rt.mailer });
const worker = startWorker(cfg.REDIS_URL, handler, cfg.WORKER_CONCURRENCY);

worker.on('completed', (job) => console.log(`[worker] ${job.name} ${job.id} erledigt`));
worker.on('failed', (job, err) => console.error(`[worker] ${job?.name} ${job?.id} fehlgeschlagen (Versuch ${job?.attemptsMade}): ${err.message}`));
console.log(`[worker] gestartet, ${cfg.WORKER_CONCURRENCY} parallele Jobs`);

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    await worker.close();
    await rt.close();
    process.exit(0);
  });
}
