import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  APP_CATALOG, allowedCollections, canChangeRole, deleteAction, findApp, inviteExpiry, isEmail, parseEmails, planRelease,
  securityScore, stateAfterEdit, stateAfterRestore, validateConnection
} from '@companygpt/core';
import { newToken, sha256 } from '@companygpt/server';
import { bad, forbidden, notFound, parse } from '../http';
import type { Deps } from '../app';

const id = z.object({ id: z.string().uuid() });
const role = z.enum(['admin', 'member']);
const security = z.object({
  inheritPermissions: z.boolean(), audit: z.boolean(), rotateCredentials: z.boolean(), excludeConfidential: z.boolean(), confirmActions: z.boolean()
});
const connectionBody = z.object({
  app: z.string(), name: z.string().trim().min(1).max(120), auth: z.enum(['delegated', 'service', 'none']),
  areas: z.array(z.string()).max(50), collectionId: z.string().uuid(), permission: z.enum(['read', 'write']),
  actions: z.array(z.string()).max(20).default([]), security, sync: z.enum(['realtime', 'hourly', 'daily']).default('hourly')
});

export async function tenantRoutes(app: FastifyInstance, { rt, guards, cfg }: Deps) {
  const member = { preHandler: guards.requireMember };
  const admin = { preHandler: guards.requireAdmin };
  const store = rt.store;

  async function collectionOf(tid: string, collectionId: string) {
    const col = (await store.listCollections(tid)).find((c) => c.id === collectionId);
    if (!col) throw bad('Unbekannte Sammlung');
    return col;
  }

  // ---------- Ich & Hinweise ----------
  app.get('/v1/me', member, async (req) => {
    const t = req.tenant!, m = req.member!;
    const notes = t.noticeVersion && t.noticeVersion !== m.seenVersion
      ? (await store.listTemplates()).find((v) => v.version === t.noticeVersion)?.notes ?? [] : [];
    return {
      member: { id: m.id, name: m.name, email: m.email, role: m.role },
      tenant: { slug: t.slug, company: t.company, gptName: t.gptName, brand: t.brand, templateVersion: t.templateVersion },
      notice: notes.length ? { version: t.noticeVersion, notes } : null
    };
  });
  app.post('/v1/me/notice-seen', member, async (req) => {
    await store.updateMember(req.tenant!.id, req.member!.id, { seenVersion: req.tenant!.noticeVersion ?? null });
    return { ok: true };
  });

  // ---------- Chat ----------
  app.post('/v1/chat', member, async (req) => {
    const body = parse(z.object({ question: z.string().trim().min(1).max(4000), exclude: z.array(z.string()).default([]) }), req.body);
    const t = req.tenant!;
    const cols = allowedCollections(await store.listCollections(t.id), req.member!.role, body.exclude);
    if (!cols.length) return { answer: 'Für dich ist aktuell keine Sammlung freigegeben. Wende dich bitte an deinen Admin.', sources: [] };
    const [embedding] = await rt.embedder.embed([body.question]);
    const hits = (await store.searchChunks(t.id, embedding, cols.map((c) => c.id), 6)).filter((h) => h.score > 0.05);
    const sources = await Promise.all([...new Set(hits.map((h) => h.sourceId))].map((sid) => store.getSource(t.id, sid)));
    const byId = new Map(sources.filter(Boolean).map((s) => [s!.id, s!]));
    const answer = await rt.llm.answer({
      gptName: t.gptName,
      instructions: 'Antworte freundlich, präzise und auf Deutsch. Nenne die Quellen.',
      question: body.question,
      contexts: hits.map((h) => ({ title: byId.get(h.sourceId)?.name ?? 'Quelle', content: h.content }))
    });
    return { answer, sources: [...byId.values()].map((s) => ({ id: s.id, name: s.name, kind: s.kind })) };
  });

  // ---------- Sammlungen ----------
  app.get('/v1/collections', member, async (req) => {
    const cols = await store.listCollections(req.tenant!.id);
    return req.member!.role === 'admin' ? cols : allowedCollections(cols, 'member');
  });
  app.patch('/v1/collections/:id', admin, async (req) => {
    const { id: cid } = parse(id, req.params);
    const body = parse(z.object({ name: z.string().min(1).optional(), gptEnabled: z.boolean().optional(), memberAccess: z.boolean().optional() }), req.body);
    return store.updateCollection(req.tenant!.id, cid, body);
  });

  // ---------- Wissen ----------
  app.get('/v1/sources', admin, async (req) => {
    const q = parse(z.object({ kind: z.string().optional(), state: z.string().optional(), collectionId: z.string().optional() }), req.query);
    return (await store.listSources(req.tenant!.id)).filter((s) =>
      (!q.kind || s.kind === q.kind) && (!q.state || (q.state === 'pending' ? s.state !== 'live' : s.state === q.state)) && (!q.collectionId || s.collectionId === q.collectionId)
    ).map(({ content, ...s }) => ({ ...s, hasContent: !!content }));
  });

  app.post('/v1/sources', admin, async (req, reply) => {
    const body = parse(z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('note'), name: z.string().trim().min(1).max(200), collectionId: z.string().uuid(), content: z.string().trim().min(1).max(100_000) }),
      z.object({ kind: z.literal('web'), name: z.string().trim().max(200).optional(), collectionId: z.string().uuid(), url: z.string().url() }),
      z.object({ kind: z.literal('file'), name: z.string().trim().min(1).max(255), collectionId: z.string().uuid(), sizeBytes: z.number().int().positive().max(200 * 1024 * 1024), content: z.string().max(5_000_000).optional() })
    ]), req.body);
    const tid = req.tenant!.id;
    await collectionOf(tid, body.collectionId);
    const src = await store.createSource(tid, {
      kind: body.kind, collectionId: body.collectionId,
      name: body.kind === 'web' ? body.name || body.url.replace(/^https?:\/\//, '') : body.name,
      content: body.kind === 'web' ? null : body.content ?? null,
      url: body.kind === 'web' ? body.url : null,
      sizeBytes: body.kind === 'file' ? body.sizeBytes : null
    });
    await rt.queue.add('index-source', { tenantId: tid, sourceId: src.id });
    // Dateien: Upload-Ziel für den Objektspeicher (S3). Der Worker indexiert nach dem Upload.
    const upload = body.kind === 'file' && !body.content ? { method: 'PUT', url: `/v1/sources/${src.id}/content` } : null;
    return reply.status(201).send({ source: src, upload });
  });

  app.put('/v1/sources/:id/content', { ...admin, bodyLimit: 10 * 1024 * 1024 }, async (req) => {
    const { id: sid } = parse(id, req.params);
    const content = typeof req.body === 'string' ? req.body : parse(z.object({ content: z.string() }), req.body).content;
    const src = await store.getSource(req.tenant!.id, sid);
    if (!src) throw notFound();
    await store.updateSource(req.tenant!.id, sid, { content, indexStatus: 'pending', state: stateAfterEdit(src.state) });
    await rt.queue.add('index-source', { tenantId: req.tenant!.id, sourceId: sid });
    return { ok: true };
  });

  app.patch('/v1/sources/:id', admin, async (req) => {
    const { id: sid } = parse(id, req.params);
    const body = parse(z.object({ name: z.string().trim().min(1).max(200).optional(), collectionId: z.string().uuid().optional(), content: z.string().max(100_000).optional() }), req.body);
    const tid = req.tenant!.id;
    const src = await store.getSource(tid, sid);
    if (!src || src.state === 'deleted') throw notFound('Quelle nicht gefunden');
    if (src.kind === 'app') throw bad('Wissen aus Apps wird über die App verwaltet');
    if (body.collectionId) await collectionOf(tid, body.collectionId);
    const updated = await store.updateSource(tid, sid, { ...body, state: stateAfterEdit(src.state), indexStatus: body.content !== undefined ? 'pending' : src.indexStatus });
    if (body.content !== undefined) await rt.queue.add('index-source', { tenantId: tid, sourceId: sid });
    return updated;
  });

  async function removeSources(tid: string, ids: string[]) {
    let removed = 0, marked = 0;
    for (const sid of ids) {
      const src = await store.getSource(tid, sid);
      if (!src || src.kind === 'app') continue;
      const action = deleteAction(src);
      if (action === 'remove') { await store.deleteSource(tid, sid); removed++; }
      if (action === 'mark') { await store.updateSource(tid, sid, { state: 'deleted', prevState: src.state }); marked++; }
    }
    return { removed, marked };
  }
  app.delete('/v1/sources/:id', admin, async (req) => removeSources(req.tenant!.id, [parse(id, req.params).id]));
  app.post('/v1/sources/bulk-delete', admin, async (req) => {
    const { ids } = parse(z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }), req.body);
    return removeSources(req.tenant!.id, ids);
  });
  app.post('/v1/sources/:id/restore', admin, async (req) => {
    const { id: sid } = parse(id, req.params);
    const src = await store.getSource(req.tenant!.id, sid);
    if (!src) throw notFound();
    return store.updateSource(req.tenant!.id, sid, { state: stateAfterRestore(src), prevState: null });
  });

  // ---------- Wissen freigeben ----------
  async function pending(tid: string) {
    const [sources, connections] = await Promise.all([store.listSources(tid), store.listConnections(tid)]);
    return { sources: sources.filter((s) => s.state !== 'live'), connections: connections.filter((c) => c.state === 'new' || c.state === 'changed' || (c.state === 'removed' && sources.some((s) => s.connectionId === c.id))) };
  }
  app.get('/v1/release', admin, async (req) => {
    const p = await pending(req.tenant!.id);
    return { count: p.sources.length + p.connections.length, ...p };
  });
  app.post('/v1/release', admin, async (req) => {
    const tid = req.tenant!.id;
    const p = await pending(tid);
    const plan = planRelease(p.sources);
    for (const c of p.connections) {
      if (c.state === 'removed') {
        plan.purge.push(...(await store.listSources(tid)).filter((s) => s.connectionId === c.id).map((s) => s.id));
      } else {
        await store.updateConnection(tid, c.id, { state: 'live' });
        await rt.queue.add('sync-connection', { tenantId: tid, connectionId: c.id });
      }
    }
    await store.applyRelease(tid, plan);
    const total = plan.publish.length + plan.purge.length + p.connections.length;
    await store.logActivity(tid, `${req.member!.name} hat ${total} Änderung(en) in ${req.tenant!.gptName} freigegeben.`);
    return { published: plan.publish.length, purged: plan.purge.length, connections: p.connections.length, waiting: plan.waiting };
  });

  // ---------- Apps ----------
  app.get('/v1/apps', member, async () => APP_CATALOG);
  app.get('/v1/connections', admin, async (req) => (await store.listConnections(req.tenant!.id)).map((c) => ({ ...c, securityScore: securityScore(c, findApp(c.app)!) })));
  app.post('/v1/connections', admin, async (req, reply) => {
    const body = parse(connectionBody, req.body);
    const def = findApp(body.app);
    if (!def) throw bad('Unbekannte App');
    await collectionOf(req.tenant!.id, body.collectionId);
    const errors = validateConnection(def, body);
    if (errors.length) throw bad(errors.join(' '));
    const conn = await store.createConnection(req.tenant!.id, { ...body, auth: def.requiresAuth ? body.auth : 'none' });
    return reply.status(201).send({ ...conn, securityScore: securityScore(conn, def) });
  });
  app.patch('/v1/connections/:id', admin, async (req) => {
    const { id: cid } = parse(id, req.params);
    const tid = req.tenant!.id;
    const conn = await store.getConnection(tid, cid);
    if (!conn || conn.state === 'removed') throw notFound('Verbindung nicht gefunden');
    const body = parse(connectionBody.omit({ app: true }).partial(), req.body);
    const def = findApp(conn.app)!;
    const merged = { ...conn, ...body };
    const errors = validateConnection(def, merged);
    if (errors.length) throw bad(errors.join(' '));
    const next = await store.updateConnection(tid, cid, { ...body, state: conn.state === 'live' ? 'changed' : conn.state });
    return { ...next, securityScore: securityScore(next, def) };
  });
  app.delete('/v1/connections/:id', admin, async (req) => {
    const { id: cid } = parse(id, req.params);
    return store.updateConnection(req.tenant!.id, cid, { state: 'removed' });
  });

  // ---------- Team & Einladungen ----------
  app.get('/v1/members', admin, async (req) => (await store.listMembers(req.tenant!.id)).map(({ passwordHash, ...m }) => m));
  app.patch('/v1/members/:id', admin, async (req) => {
    const { id: mid } = parse(id, req.params);
    const { role: next } = parse(z.object({ role }), req.body);
    const tid = req.tenant!.id;
    if (!canChangeRole(await store.listMembers(tid), mid, next)) throw bad('Es muss mindestens ein Admin im Team bleiben.');
    const { passwordHash, ...m } = await store.updateMember(tid, mid, { role: next });
    return m;
  });
  app.delete('/v1/members/:id', admin, async (req) => {
    const { id: mid } = parse(id, req.params);
    if (mid === req.member!.id) throw bad('Du kannst dich nicht selbst entfernen.');
    await store.deleteMember(req.tenant!.id, mid);
    return { ok: true };
  });

  const inviteLink = (slug: string, token: string) => `https://${slug}.${cfg.PLATFORM_DOMAIN}/einladung/${token}`;
  async function mailInvite(slug: string, gptName: string, email: string, by: string, message: string, token: string) {
    await rt.queue.add('send-email', {
      to: email, fromName: gptName, subject: `${by} hat dich zu ${gptName} eingeladen`,
      text: `${by} hat dich eingeladen, ${gptName} zu nutzen.${message ? `\n\n„${message}“` : ''}\n\nEinladung annehmen: ${inviteLink(slug, token)}\n(7 Tage gültig)`
    });
  }

  app.get('/v1/invites', admin, async (req) => (await store.listInvites(req.tenant!.id)).map(({ tokenHash, ...i }) => i));
  app.post('/v1/invites', admin, async (req, reply) => {
    const body = parse(z.object({ emails: z.string().min(3), role: role.default('member'), message: z.string().max(1000).default('') }), req.body);
    const t = req.tenant!, me = req.member!;
    const emails = parseEmails(body.emails);
    const invalid = emails.filter((e) => !isEmail(e));
    if (!emails.length || invalid.length) throw bad(invalid.length ? `Ungültige Adresse: ${invalid.join(', ')}` : 'Bitte mindestens eine E-Mail angeben.');
    if (emails.length > 200) throw bad('Höchstens 200 Einladungen auf einmal.');
    const existing = new Set((await store.listMembers(t.id)).map((m) => m.email.toLowerCase()));
    const already = emails.filter((e) => existing.has(e));
    if (already.length) throw bad(`Schon im Team: ${already.join(', ')}`);
    const open = await store.listInvites(t.id);
    const created = [];
    for (const email of emails) {
      const token = newToken();
      const prev = open.find((i) => i.email === email && i.status === 'pending');
      const data = { role: body.role, message: body.message, tokenHash: sha256(token), expiresAt: inviteExpiry(new Date()).toISOString() };
      const inv = prev
        ? await store.updateInvite(t.id, prev.id, { ...data, sentAt: new Date().toISOString() })
        : await store.createInvite(t.id, { email, invitedBy: me.name, ...data });
      await mailInvite(t.slug, t.gptName, email, me.name, body.message, token);
      created.push(inv.id);
    }
    await store.logActivity(t.id, `${me.name} hat ${emails.length} Person(en) zu ${t.gptName} eingeladen.`);
    return reply.status(201).send({ invited: created.length });
  });
  app.post('/v1/invites/:id/resend', admin, async (req) => {
    const { id: iid } = parse(id, req.params);
    const t = req.tenant!;
    const inv = (await store.listInvites(t.id)).find((i) => i.id === iid);
    if (!inv || inv.status !== 'pending') throw notFound('Offene Einladung nicht gefunden');
    const token = newToken();
    await store.updateInvite(t.id, iid, { tokenHash: sha256(token), sentAt: new Date().toISOString(), expiresAt: inviteExpiry(new Date()).toISOString() });
    await mailInvite(t.slug, t.gptName, inv.email, req.member!.name, inv.message, token);
    return { ok: true };
  });
  app.post('/v1/invites/:id/revoke', admin, async (req) => {
    const { id: iid } = parse(id, req.params);
    const { tokenHash, ...inv } = await store.updateInvite(req.tenant!.id, iid, { status: 'revoked' });
    return inv;
  });

  // ---------- Support ----------
  const ticketBody = z.object({
    kind: z.enum(['problem', 'question', 'wish']), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(10_000),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'), context: z.string().max(500).default('')
  });
  async function ownTicket(req: { tenant?: { id: string }; member?: { id: string; role: string } }, tid: string) {
    const t = await store.getTicket(tid, req.tenant!.id);
    if (!t) throw notFound('Anfrage nicht gefunden');
    if (req.member!.role !== 'admin' && t.memberId !== req.member!.id) throw forbidden();
    return t;
  }
  app.get('/v1/tickets', member, async (req) => store.listTickets({ tenantId: req.tenant!.id, memberId: req.member!.role === 'admin' ? undefined : req.member!.id }));
  app.post('/v1/tickets', member, async (req, reply) => {
    const b = parse(ticketBody, req.body);
    const t = await store.createTicket(req.tenant!.id, { ...b, memberId: req.member!.id, memberName: req.member!.name });
    await store.logActivity(req.tenant!.id, `${req.member!.name} (${req.tenant!.gptName}) hat Support-Anfrage T-${t.number} gestellt.`);
    return reply.status(201).send(t);
  });
  app.get('/v1/tickets/:id', member, async (req) => {
    const t = await ownTicket(req, parse(id, req.params).id);
    if (t.memberId === req.member!.id && t.unreadUser) return store.updateTicket(t.id, req.tenant!.id, { unreadUser: false });
    return t;
  });
  app.post('/v1/tickets/:id/messages', member, async (req) => {
    const t = await ownTicket(req, parse(id, req.params).id);
    const b = parse(z.object({ body: z.string().trim().max(10_000).default(''), solve: z.boolean().default(false) }), req.body);
    if (!b.body && !b.solve) throw bad('Bitte eine Nachricht eingeben.');
    if (!b.body) return store.updateTicket(t.id, req.tenant!.id, { status: 'solved' });
    return store.addTicketMessage(t.id, req.tenant!.id, { author: 'user', authorName: req.member!.name, body: b.body }, { status: b.solve ? 'solved' : 'open', unreadSupport: true });
  });
  app.post('/v1/tickets/:id/reopen', member, async (req) => {
    const t = await ownTicket(req, parse(id, req.params).id);
    return store.updateTicket(t.id, req.tenant!.id, { status: 'open', unreadSupport: true });
  });
}

