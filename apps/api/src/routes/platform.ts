import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_COLLECTIONS, compareVersions, contrastOnWhiteText, inviteExpiry, isHexColor, isSlug, nextVersion, slugify } from '@companygpt/core';
import { newToken, sha256 } from '@companygpt/server';
import { bad, notFound, parse } from '../http';
import type { Deps } from '../app';

const id = z.object({ id: z.string().uuid() });
const brand = z.object({
  primary: z.string().refine(isHexColor, 'Hex-Farbe wie #0040C4'),
  logoUrl: z.string().url().nullable().optional(),
  markUrl: z.string().url().nullable().optional()
});

/** CompanyGPT-Steuerzentrale: Kunden, Vorlagen & Rollouts, Support, Aktivität. */
export async function platformRoutes(app: FastifyInstance, { rt, guards, cfg }: Deps) {
  const platform = { preHandler: guards.requirePlatform };
  const store = rt.store;

  app.get('/platform/overview', platform, async () => {
    const [tenants, latest, open] = await Promise.all([store.listTenants(), store.latestTemplate(), store.listTickets({ status: ['new', 'open', 'waiting'] })]);
    return {
      tenants: tenants.length,
      activeUsers: tenants.reduce((n, t) => n + t.members, 0),
      openTickets: open.length,
      newTickets: open.filter((t) => t.unreadSupport).length,
      outdated: tenants.filter((t) => compareVersions(t.templateVersion, latest.version) < 0).length,
      latestVersion: latest.version,
      activity: await store.listActivity(10)
    };
  });

  // ---------- Kunden ----------
  app.get('/platform/tenants', platform, async () => {
    const latest = await store.latestTemplate();
    return (await store.listTenants()).map((t) => ({ ...t, outdated: compareVersions(t.templateVersion, latest.version) < 0, domain: `${t.slug}.${cfg.PLATFORM_DOMAIN}` }));
  });

  app.post('/platform/tenants', platform, async (req, reply) => {
    const b = parse(z.object({
      company: z.string().trim().min(1).max(160), slug: z.string().optional(), gptName: z.string().trim().min(1).max(60), brand,
      adminEmail: z.string().email(), adminName: z.string().max(120).default(''),
      collections: z.array(z.string()).optional()
    }), req.body);
    const slug = b.slug ?? slugify(b.company);
    if (!isSlug(slug)) throw bad('Die Adresse darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten (2–30 Zeichen).');
    const enabled = b.collections ?? ['hr', 'tech', 'sales', 'it'];
    let tenant;
    try {
      tenant = await store.createTenant({
        slug, company: b.company, gptName: b.gptName, brand: b.brand, templateVersion: (await store.latestTemplate()).version,
        collections: DEFAULT_COLLECTIONS.map((c) => ({ ...c, gptEnabled: enabled.includes(c.key) }))
      });
    } catch (e) {
      if ((e as Error).message === 'slug_taken') throw bad('Diese Adresse ist schon vergeben.');
      throw e;
    }
    const token = newToken();
    await store.createInvite(tenant.id, { email: b.adminEmail, role: 'admin', invitedBy: 'CompanyGPT-Team', message: '', tokenHash: sha256(token), expiresAt: inviteExpiry(new Date()).toISOString() });
    await rt.queue.add('send-email', {
      to: b.adminEmail, fromName: b.gptName, subject: `Richte ${b.gptName} für ${b.company} ein`,
      text: `Dein Wissensassistent ${b.gptName} ist bereit.\n\nJetzt einrichten: https://${slug}.${cfg.PLATFORM_DOMAIN}/einladung/${token}\n(7 Tage gültig)`
    });
    await store.logActivity(tenant.id, `Kunden-Dashboard „${b.gptName}“ für ${b.company} angelegt, Einladung an ${b.adminEmail} verschickt.`);
    return reply.status(201).send({ tenant, warnings: contrastOnWhiteText(b.brand.primary) < 4.5 ? ['Weiße Schrift auf der Primärfarbe ist schwer lesbar.'] : [] });
  });

  app.patch('/platform/tenants/:id', platform, async (req) => {
    const { id: tid } = parse(id, req.params);
    const b = parse(z.object({ company: z.string().trim().min(1).optional(), gptName: z.string().trim().min(1).optional(), brand: brand.optional(), status: z.enum(['active', 'suspended']).optional() }), req.body);
    if (!(await store.getTenant(tid))) throw notFound('Kunde nicht gefunden');
    const t = await store.updateTenant(tid, b);
    await store.logActivity(tid, `${t.gptName}: Einstellungen aus der Steuerzentrale aktualisiert.`);
    return t;
  });

  // ---------- Vorlagen & Rollouts ----------
  app.get('/platform/templates', platform, async () => store.listTemplates());
  app.post('/platform/templates', platform, async (req, reply) => {
    const b = parse(z.object({ notes: z.array(z.string().trim().min(1)).min(1).max(30), kind: z.enum(['minor', 'major']).default('minor') }), req.body);
    const version = nextVersion((await store.latestTemplate()).version, b.kind);
    const t = await store.publishTemplate(version, b.notes);
    await store.logActivity(null, `Vorlage v${version} veröffentlicht.`);
    return reply.status(201).send(t);
  });
  app.post('/platform/rollouts', platform, async (req, reply) => {
    const b = parse(z.object({ tenantIds: z.array(z.string().uuid()).optional(), batchSize: z.number().int().min(1).max(500).optional() }), req.body);
    const latest = await store.latestTemplate();
    await rt.queue.add('rollout', { version: latest.version, tenantIds: b.tenantIds, batchSize: b.batchSize });
    return reply.status(202).send({ version: latest.version, queued: true });
  });

  // ---------- Support ----------
  app.get('/platform/tickets', platform, async (req) => {
    const q = parse(z.object({ status: z.string().optional() }), req.query);
    const status = q.status === 'active' || !q.status ? ['new', 'open', 'waiting'] as const : q.status === 'all' ? undefined : q.status.split(',');
    return store.listTickets({ status: status as never });
  });
  app.get('/platform/tickets/:id', platform, async (req) => {
    const t = await store.getTicket(parse(id, req.params).id);
    if (!t) throw notFound('Anfrage nicht gefunden');
    return t.unreadSupport || t.status === 'new' ? store.updateTicket(t.id, undefined, { unreadSupport: false, status: t.status === 'new' ? 'open' : t.status }) : t;
  });
  app.patch('/platform/tickets/:id', platform, async (req) => {
    const b = parse(z.object({ status: z.enum(['new', 'open', 'waiting', 'solved']).optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional() }), req.body);
    return store.updateTicket(parse(id, req.params).id, undefined, b);
  });
  app.post('/platform/tickets/:id/messages', platform, async (req) => {
    const { id: kid } = parse(id, req.params);
    const b = parse(z.object({ body: z.string().trim().min(1).max(10_000), solve: z.boolean().default(false) }), req.body);
    const t = await store.addTicketMessage(kid, undefined, { author: 'support', authorName: 'CompanyGPT-Support', body: b.body }, { status: b.solve ? 'solved' : 'waiting', unreadUser: true, unreadSupport: false });
    await store.logActivity(t.tenantId, `Support hat auf T-${t.number} geantwortet${b.solve ? ' und die Anfrage gelöst' : ''}.`);
    return t;
  });

  app.get('/platform/activity', platform, async (req) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    return store.listActivity(q.limit);
  });
}
