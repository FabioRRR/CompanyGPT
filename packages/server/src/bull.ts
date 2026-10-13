import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import type { JobData, JobHandler, JobName, JobQueue } from './infra';

export const QUEUE_NAME = 'companygpt';

const connection = (url: string) => new IORedis(url, { maxRetriesPerRequest: null });

/** Redis-Warteschlange: API-Instanzen legen Jobs ab, beliebig viele Worker arbeiten sie ab. */
export class BullQueue implements JobQueue {
  private queue: Queue;
  constructor(redisUrl: string) {
    this.queue = new Queue(QUEUE_NAME, {
      connection: connection(redisUrl),
      defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 }
    });
  }
  async add<N extends JobName>(name: N, data: JobData[N]) {
    // Indexierung pro Quelle entprellen: gleiche jobId = kein doppelter Job
    const jobId = name === 'index-source' ? `index:${(data as JobData['index-source']).sourceId}:${Date.now() >> 12}` : undefined;
    await this.queue.add(name, data, { jobId });
  }
  async close() { await this.queue.close(); }
}

export function startWorker(redisUrl: string, handler: JobHandler, concurrency: number) {
  return new Worker(QUEUE_NAME, async (job) => handler(job.name as JobName, job.data), {
    connection: connection(redisUrl),
    concurrency,
    // Schutz für das Sprachmodell-/Embedding-Kontingent
    limiter: { max: 50, duration: 1000 }
  });
}
