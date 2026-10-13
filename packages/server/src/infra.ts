import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length);
  return timingSafeEqual(key, expected);
}

export const newToken = () => randomBytes(32).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// ---------- E-Mail ----------
export interface Mail { to: string; subject: string; text: string; fromName: string }
export interface Mailer { send(mail: Mail): Promise<void> }

/** Schreibt E-Mails ins Log (Entwicklung) und hält sie für Tests vor. In Produktion: SMTP/SES/Postmark. */
export class LogMailer implements Mailer {
  readonly sent: Mail[] = [];
  async send(mail: Mail) {
    this.sent.push(mail);
    if (process.env.NODE_ENV !== 'test') console.log(`[mail] an ${mail.to}: ${mail.subject}`);
  }
}

// ---------- Hintergrund-Jobs ----------
export type JobName = 'index-source' | 'send-email' | 'rollout' | 'sync-connection';
export interface JobData {
  'index-source': { tenantId: string; sourceId: string };
  'send-email': Mail;
  rollout: { version: string; tenantIds?: string[]; batchSize?: number };
  'sync-connection': { tenantId: string; connectionId: string };
}
export type JobHandler = <N extends JobName>(name: N, data: JobData[N]) => Promise<void>;

export interface JobQueue {
  add<N extends JobName>(name: N, data: JobData[N]): Promise<void>;
  close(): Promise<void>;
}

/** Führt Jobs im selben Prozess aus (Entwicklung/Tests). drain() wartet auf alle offenen Jobs. */
export class InlineQueue implements JobQueue {
  private pending = new Set<Promise<void>>();
  readonly failures: { name: JobName; error: unknown }[] = [];
  private handler: JobHandler | null = null;

  setHandler(h: JobHandler) { this.handler = h; }

  async add<N extends JobName>(name: N, data: JobData[N]) {
    if (!this.handler) throw new Error('Kein Job-Handler registriert');
    const p: Promise<void> = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => this.handler!(name, data))
      .catch((error) => { this.failures.push({ name, error }); })
      .finally(() => { this.pending.delete(p); });
    this.pending.add(p);
  }

  async drain() {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  async close() { await this.drain(); }
}
