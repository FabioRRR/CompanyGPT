import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { themeCss } from '@companygpt/core';
import { hashPassword, sha256, verifyPassword } from '@companygpt/server';
import { HttpError, bad, notFound, parse } from '../http';
import type { Deps } from '../app';

const loginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
const acceptBody = z.object({ name: z.string().trim().min(1).max(120), password: z.string().min(8, 'Mindestens 8 Zeichen') });

/** Öffentliche Endpunkte eines Kunden-Dashboards: Branding, Login, Einladung annehmen. */
export async function publicRoutes(app: FastifyInstance, { rt, tokens, guards }: Deps) {
  app.get('/v1/tenant', { preHandler: guards.requireTenant }, async (req) => {
    const t = req.tenant!;
    return { slug: t.slug, company: t.company, gptName: t.gptName, brand: t.brand, themeCss: themeCss(t.brand.primary) };
  });

  app.post('/v1/auth/login', { preHandler: guards.requireTenant }, async (req) => {
    const { email, password } = parse(loginBody, req.body);
    const member = await rt.store.findMemberByEmail(req.tenant!.id, email);
    if (!member || !(await verifyPassword(password, member.passwordHash))) throw new HttpError(401, 'E-Mail oder Passwort ist falsch.');
    return { token: await tokens.sign({ kind: 'member', sub: member.id, tid: req.tenant!.id }), member: { id: member.id, name: member.name, role: member.role } };
  });

  async function loadInvite(tenantId: string, token: string) {
    const inv = await rt.store.findInviteByTokenHash(sha256(token));
    if (!inv || inv.tenantId !== tenantId) throw notFound('Einladung nicht gefunden');
    if (inv.status !== 'pending') throw new HttpError(410, 'Diese Einladung wurde bereits angenommen oder widerrufen.');
    if (new Date(inv.expiresAt).getTime() < Date.now()) throw new HttpError(410, 'Diese Einladung ist abgelaufen. Bitte deinen Admin um eine neue.');
    return inv;
  }

  app.get('/v1/invites/token/:token', { preHandler: guards.requireTenant }, async (req) => {
    const inv = await loadInvite(req.tenant!.id, (req.params as { token: string }).token);
    return { email: inv.email, role: inv.role, invitedBy: inv.invitedBy, message: inv.message, gptName: req.tenant!.gptName, company: req.tenant!.company };
  });

  app.post('/v1/invites/token/:token/accept', { preHandler: guards.requireTenant }, async (req) => {
    const t = req.tenant!;
    const inv = await loadInvite(t.id, (req.params as { token: string }).token);
    const { name, password } = parse(acceptBody, req.body);
    if (await rt.store.findMemberByEmail(t.id, inv.email)) throw bad('Für diese E-Mail gibt es schon ein Konto.');
    const member = await rt.store.createMember(t.id, { name, email: inv.email, role: inv.role, passwordHash: await hashPassword(password) });
    await rt.store.updateInvite(t.id, inv.id, { status: 'accepted' });
    if (t.status === 'invited' && inv.role === 'admin') await rt.store.updateTenant(t.id, { status: 'active' });
    await rt.store.logActivity(t.id, `${name} hat die Einladung zu ${t.gptName} angenommen.`);
    return { token: await tokens.sign({ kind: 'member', sub: member.id, tid: t.id }), member: { id: member.id, name: member.name, role: member.role } };
  });

  app.post('/platform/auth/login', async (req) => {
    const { email, password } = parse(loginBody, req.body);
    const user = await rt.store.findPlatformUser(email);
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new HttpError(401, 'E-Mail oder Passwort ist falsch.');
    return { token: await tokens.sign({ kind: 'platform', sub: user.id }, '8h'), user: { id: user.id, name: user.name, email: user.email } };
  });
}
