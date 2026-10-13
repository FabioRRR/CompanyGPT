import { expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { InlineQueue, LogMailer, type Runtime } from '@companygpt/server';

type Inject = (opts: { method: string; url: string; tenant?: string; token?: string; body?: unknown }) => Promise<{ status: number; json: any }>;

export function client(app: FastifyInstance): Inject {
  return async ({ method, url, tenant, token, body }) => {
    const res = await app.inject({
      method: method as any, url,
      headers: { ...(tenant ? { 'x-tenant': tenant } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      payload: body as any
    });
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  };
}

const tokenFromMail = (text: string) => /einladung\/([\w-]+)/.exec(text)![1];

/** Kompletter Ablauf: Kunde anlegen → Admin einladen → Wissen → Freigabe → Chat → Team → Support → Update. */
export async function fullScenario(app: FastifyInstance, rt: Runtime) {
  const api = client(app);
  const queue = rt.queue as InlineQueue;
  const mailer = rt.mailer as LogMailer;

  // Steuerzentrale
  const login = await api({ method: 'POST', url: '/platform/auth/login', body: { email: 'du@companygpt.demo', password: 'demo1234' } });
  expect(login.status).toBe(200);
  const P = login.json.token as string;

  const created = await api({ method: 'POST', url: '/platform/tenants', token: P, body: { company: 'Muster Messtechnik GmbH', gptName: 'MusterGPT', brand: { primary: '#6D28D9' }, adminEmail: 'it@muster.example' } });
  expect(created.status).toBe(201);
  expect(created.json.tenant.slug).toBe('muster-messtechnik');
  const dup = await api({ method: 'POST', url: '/platform/tenants', token: P, body: { company: 'Muster Messtechnik GmbH', gptName: 'X', brand: { primary: '#6D28D9' }, adminEmail: 'a@b.de' } });
  expect(dup.status).toBe(400);
  await queue.drain();
  const adminMail = mailer.sent.find((m) => m.to === 'it@muster.example')!;
  expect(adminMail.subject).toContain('MusterGPT');

  // Branding ist öffentlich lesbar (Login-Seite)
  const T = 'muster-messtechnik';
  const branding = await api({ method: 'GET', url: '/v1/tenant', tenant: T });
  expect(branding.json.gptName).toBe('MusterGPT');
  expect(branding.json.themeCss).toContain('--p:#6D28D9');

  // Admin nimmt Einladung an
  const inviteToken = tokenFromMail(adminMail.text);
  const info = await api({ method: 'GET', url: `/v1/invites/token/${inviteToken}`, tenant: T });
  expect(info.json.role).toBe('admin');
  const weak = await api({ method: 'POST', url: `/v1/invites/token/${inviteToken}/accept`, tenant: T, body: { name: 'Ida Admin', password: 'kurz' } });
  expect(weak.status).toBe(400);
  const acc = await api({ method: 'POST', url: `/v1/invites/token/${inviteToken}/accept`, tenant: T, body: { name: 'Ida Admin', password: 'sicher1234' } });
  expect(acc.status).toBe(200);
  const A = acc.json.token as string;
  const again = await api({ method: 'POST', url: `/v1/invites/token/${inviteToken}/accept`, tenant: T, body: { name: 'X', password: 'sicher1234' } });
  expect(again.status).toBe(410);

  // Token gilt nur für den eigenen Kunden
  const foreign = await api({ method: 'GET', url: '/v1/me', tenant: 'gantner', token: A });
  expect(foreign.status).toBe(401);

  // Wissen erfassen → noch nicht im Chat → freigeben → im Chat
  const cols = (await api({ method: 'GET', url: '/v1/collections', tenant: T, token: A })).json;
  const tech = cols.find((c: any) => c.key === 'tech');
  const note = await api({ method: 'POST', url: '/v1/sources', tenant: T, token: A, body: { kind: 'note', name: 'Ansprechpartner Applikationstechnik', collectionId: tech.id, content: 'Für Fragen zur Systemauslegung ist die Applikationstechnik zuständig. Ansprechpartnerin ist Frau Berger, Durchwahl 42.' } });
  expect(note.status).toBe(201);
  await queue.drain();
  const before = await api({ method: 'POST', url: '/v1/chat', tenant: T, token: A, body: { question: 'Wer ist für die Systemauslegung zuständig?' } });
  expect(before.json.sources).toHaveLength(0);
  const pending = await api({ method: 'GET', url: '/v1/release', tenant: T, token: A });
  expect(pending.json.count).toBe(1);
  const rel = await api({ method: 'POST', url: '/v1/release', tenant: T, token: A });
  expect(rel.json.published).toBe(1);
  const after = await api({ method: 'POST', url: '/v1/chat', tenant: T, token: A, body: { question: 'Wer ist für die Systemauslegung zuständig?' } });
  expect(after.json.sources[0].name).toBe('Ansprechpartner Applikationstechnik');
  expect(after.json.answer).toContain('Berger');

  // Mitarbeiter einladen und anmelden
  const inv = await api({ method: 'POST', url: '/v1/invites', tenant: T, token: A, body: { emails: 'kai@muster.example, falsch', role: 'member' } });
  expect(inv.status).toBe(400);
  const inv2 = await api({ method: 'POST', url: '/v1/invites', tenant: T, token: A, body: { emails: 'kai@muster.example', role: 'member', message: 'Willkommen!' } });
  expect(inv2.json.invited).toBe(1);
  await queue.drain();
  const kaiMail = mailer.sent.filter((m) => m.to === 'kai@muster.example').pop()!;
  const kai = await api({ method: 'POST', url: `/v1/invites/token/${tokenFromMail(kaiMail.text)}/accept`, tenant: T, body: { name: 'Kai', password: 'kai-passwort' } });
  const K = kai.json.token as string;
  const kaiLogin = await api({ method: 'POST', url: '/v1/auth/login', tenant: T, body: { email: 'kai@muster.example', password: 'kai-passwort' } });
  expect(kaiLogin.status).toBe(200);
  expect((await api({ method: 'GET', url: '/v1/sources', tenant: T, token: K })).status).toBe(403);

  // Rechte: Mitarbeiter sehen gesperrte Sammlungen nicht
  await api({ method: 'PATCH', url: `/v1/collections/${tech.id}`, tenant: T, token: A, body: { memberAccess: false } });
  const kaiChat = await api({ method: 'POST', url: '/v1/chat', tenant: T, token: K, body: { question: 'Wer ist für die Systemauslegung zuständig?' } });
  expect(kaiChat.json.sources).toHaveLength(0);

  // Löschen: markiert, wiederherstellbar, mit Freigabe endgültig weg
  await api({ method: 'DELETE', url: `/v1/sources/${note.json.source.id}`, tenant: T, token: A });
  let list = (await api({ method: 'GET', url: '/v1/sources', tenant: T, token: A })).json;
  expect(list[0].state).toBe('deleted');
  await api({ method: 'POST', url: `/v1/sources/${note.json.source.id}/restore`, tenant: T, token: A });
  await api({ method: 'DELETE', url: `/v1/sources/${note.json.source.id}`, tenant: T, token: A });
  expect((await api({ method: 'POST', url: '/v1/release', tenant: T, token: A })).json.purged).toBe(1);
  list = (await api({ method: 'GET', url: '/v1/sources', tenant: T, token: A })).json;
  expect(list).toHaveLength(0);

  // Apps: Verbindung mit Sicherheitsbewertung
  const conn = await api({ method: 'POST', url: '/v1/connections', tenant: T, token: A, body: {
    app: 'business-central', name: 'ERP', auth: 'delegated', areas: ['inventory'], collectionId: tech.id, permission: 'write', actions: ['post'],
    security: { inheritPermissions: true, audit: false, rotateCredentials: true, excludeConfidential: true, confirmActions: false }
  } });
  expect(conn.status).toBe(201);
  expect(conn.json.securityScore.level).not.toBe('high');
  const badConn = await api({ method: 'POST', url: '/v1/connections', tenant: T, token: A, body: {
    app: 'business-central', name: 'ERP', auth: 'delegated', areas: [], collectionId: tech.id, permission: 'read', actions: [],
    security: { inheritPermissions: true, audit: true, rotateCredentials: true, excludeConfidential: true, confirmActions: true }
  } });
  expect(badConn.status).toBe(400);
  await api({ method: 'POST', url: '/v1/release', tenant: T, token: A });
  await queue.drain();
  const appSources = (await api({ method: 'GET', url: '/v1/sources?kind=app', tenant: T, token: A })).json;
  expect(appSources.map((s: any) => s.name)).toEqual(['Microsoft Business Central · Lagerbestand']);

  // Letzter Admin bleibt Admin
  const members = (await api({ method: 'GET', url: '/v1/members', tenant: T, token: A })).json;
  const ida = members.find((m: any) => m.email === 'it@muster.example');
  expect((await api({ method: 'PATCH', url: `/v1/members/${ida.id}`, tenant: T, token: A, body: { role: 'member' } })).status).toBe(400);

  // Support: Anfrage → Steuerzentrale antwortet → Mitarbeiter sieht Antwort
  const ticket = await api({ method: 'POST', url: '/v1/tickets', tenant: T, token: K, body: { kind: 'problem', subject: 'Upload bricht ab', body: 'Ab 50 MB kommt ein Fehler.', priority: 'high' } });
  expect(ticket.status).toBe(201);
  const inbox = (await api({ method: 'GET', url: '/platform/tickets', token: P })).json;
  expect(inbox.some((t: any) => t.id === ticket.json.id && t.unreadSupport)).toBe(true);
  const opened = await api({ method: 'GET', url: `/platform/tickets/${ticket.json.id}`, token: P });
  expect(opened.json.status).toBe('open');
  await api({ method: 'POST', url: `/platform/tickets/${ticket.json.id}/messages`, token: P, body: { body: 'Ist behoben, bitte nochmal versuchen.' } });
  const mine = (await api({ method: 'GET', url: '/v1/tickets', tenant: T, token: K })).json;
  expect(mine[0].unreadUser).toBe(true);
  expect(mine[0].status).toBe('waiting');
  const read = await api({ method: 'GET', url: `/v1/tickets/${ticket.json.id}`, tenant: T, token: K });
  expect(read.json.unreadUser).toBe(false);
  expect(read.json.messages).toHaveLength(2);
  // fremde Kunden sehen die Anfrage nicht
  const gantnerAdmin = (await api({ method: 'POST', url: '/v1/auth/login', tenant: 'gantner', body: { email: 'admin@gantner-instruments.com', password: 'demo1234' } })).json.token;
  expect((await api({ method: 'GET', url: `/v1/tickets/${ticket.json.id}`, tenant: 'gantner', token: gantnerAdmin })).status).toBe(404);

  // Update: neue Version, gezielt ausrollen, Hinweis für Benutzer
  const v = await api({ method: 'POST', url: '/platform/templates', token: P, body: { notes: ['Größere Uploads bis 200 MB'] } });
  expect(v.json.version).toBe('1.5');
  const tenants = (await api({ method: 'GET', url: '/platform/tenants', token: P })).json;
  const muster = tenants.find((t: any) => t.slug === T);
  expect(muster.outdated).toBe(true);
  await api({ method: 'POST', url: '/platform/rollouts', token: P, body: { tenantIds: [muster.id] } });
  await queue.drain();
  const after2 = (await api({ method: 'GET', url: '/platform/tenants', token: P })).json;
  expect(after2.find((t: any) => t.slug === T).templateVersion).toBe('1.5');
  expect(after2.find((t: any) => t.slug === 'gantner').templateVersion).toBe('1.4');
  const me = (await api({ method: 'GET', url: '/v1/me', tenant: T, token: K })).json;
  expect(me.notice.notes).toEqual(['Größere Uploads bis 200 MB']);
  await api({ method: 'POST', url: '/v1/me/notice-seen', tenant: T, token: K });
  expect((await api({ method: 'GET', url: '/v1/me', tenant: T, token: K })).json.notice).toBeNull();

  const overview = (await api({ method: 'GET', url: '/platform/overview', token: P })).json;
  expect(overview.tenants).toBe(2);
  expect(overview.outdated).toBe(1);
  expect(queue.failures).toEqual([]);
}
