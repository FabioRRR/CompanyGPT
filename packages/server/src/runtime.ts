import { AnthropicLlm, ExtractiveLlm, HashEmbedder, HttpEmbedder, type Embedder, type Llm } from './ai';
import { BullQueue } from './bull';
import type { Config } from './config';
import { InlineQueue, LogMailer, type JobQueue, type Mailer } from './infra';
import { createJobHandler } from './jobs';
import { MemoryStore } from './store/memory';
import { PostgresStore } from './store/postgres';
import type { Store } from './store/types';

export interface Runtime {
  store: Store;
  queue: JobQueue;
  embedder: Embedder;
  llm: Llm;
  mailer: Mailer;
  close(): Promise<void>;
}

/** Baut alle Abhängigkeiten aus der Konfiguration. Ohne DB/Redis: In-Memory + Inline-Jobs. */
export function createRuntime(cfg: Config, overrides: Partial<Runtime> = {}): Runtime {
  const store = overrides.store ?? (cfg.DATABASE_URL ? new PostgresStore(cfg.DATABASE_URL, cfg.DATABASE_POOL_SIZE) : new MemoryStore());
  const embedder = overrides.embedder ?? (cfg.EMBEDDINGS_URL && cfg.EMBEDDINGS_API_KEY && cfg.EMBEDDINGS_MODEL
    ? new HttpEmbedder(cfg.EMBEDDINGS_URL, cfg.EMBEDDINGS_API_KEY, cfg.EMBEDDINGS_MODEL)
    : new HashEmbedder());
  const llm = overrides.llm ?? (cfg.ANTHROPIC_API_KEY ? new AnthropicLlm(cfg.ANTHROPIC_API_KEY, cfg.LLM_MODEL) : new ExtractiveLlm());
  const mailer = overrides.mailer ?? new LogMailer();
  let queue = overrides.queue;
  if (!queue) {
    if (cfg.REDIS_URL) queue = new BullQueue(cfg.REDIS_URL);
    else {
      const inline = new InlineQueue();
      inline.setHandler(createJobHandler({ store, embedder, mailer }));
      queue = inline;
    }
  }
  return {
    store, queue, embedder, llm, mailer,
    async close() { await queue!.close(); await store.close(); }
  };
}
