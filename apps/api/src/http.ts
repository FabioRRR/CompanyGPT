import type { FastifyReply, FastifyRequest } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { NotFoundError, type Runtime } from '@companygpt/server';
import type { Member, Tenant } from '@companygpt/core';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const bad = (m: string) => new HttpError(400, m);
export const forbidden = (m = 'Keine Berechtigung') => new HttpError(403, m);
export const notFound = (m = 'Nicht gefunden') => new HttpError(404, m);

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data ?? {});
}

export function errorHandler(err: unknown, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
  if (err instanceof ZodError) return reply.status(400).send({ error: 'Ungültige Eingabe', details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
  if (err instanceof NotFoundError) return reply.status(404).send({ error: err.message });
  const e = err as { statusCode?: number; message?: string };
  if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.message });
  req.log.error(err);
  return reply.status(500).send({ error: 'Interner Fehler' });
}

// ---------- Tokens ----------
export type Claims =
  | { kind: 'member'; sub: string; tid: string }
  | { kind: 'platform'; sub: string };

export class Tokens {
  private key: Uint8Array;
  constructor(secret: string) { this.key = new TextEncoder().encode(secret); }
  sign(claims: Claims, ttl = '12h') {
    return new SignJWT({ ...claims }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(ttl).sign(this.key);
  }
  async verify(token: string): Promise<Claims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key);
      return payload as unknown as Claims;
    } catch {
      return null;
    }
  }
}

// ---------- Anfrage-Kontext ----------
declare module 'fastify' {
  interface FastifyRequest {
    tenant?: Tenant;
    member?: Member;
    platformUser?: { id: string; email: string; name: string };
    claims?: Claims | null;
  }
}

/** Kunde aus der Subdomain (gantner.companygpt.app) oder dem Header x-tenant ermitteln. */
export function tenantSlug(req: FastifyRequest, platformDomain: string): string | null {
  const header = req.headers['x-tenant'];
  if (typeof header === 'string' && header) return header.toLowerCase();
  const host = (req.headers.host ?? '').split(':')[0].toLowerCase();
  if (host.endsWith('.' + platformDomain)) {
    const sub = host.slice(0, -(platformDomain.length + 1));
    if (sub && !sub.includes('.') && sub !== 'konsole') return sub;
  }
  return null;
}

export async function bearer(req: FastifyRequest, tokens: Tokens) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  return tokens.verify(h.slice(7));
}

export function makeGuards(rt: Runtime, tokens: Tokens, platformDomain: string) {
  async function requireTenant(req: FastifyRequest) {
    const slug = tenantSlug(req, platformDomain);
    if (!slug) throw notFound('Kein Kunden-Dashboard angegeben');
    const tenant = await rt.store.getTenantBySlug(slug);
    if (!tenant || tenant.status === 'suspended') throw notFound('Kunden-Dashboard nicht gefunden');
    req.tenant = tenant;
  }
  async function requireMember(req: FastifyRequest) {
    await requireTenant(req);
    const claims = await bearer(req, tokens);
    if (!claims || claims.kind !== 'member' || claims.tid !== req.tenant!.id) throw new HttpError(401, 'Bitte melde dich an');
    const member = await rt.store.getMember(req.tenant!.id, claims.sub);
    if (!member) throw new HttpError(401, 'Konto existiert nicht mehr');
    req.claims = claims;
    req.member = member;
  }
  async function requireAdmin(req: FastifyRequest) {
    await requireMember(req);
    if (req.member!.role !== 'admin') throw forbidden('Nur für Admins');
  }
  async function requirePlatform(req: FastifyRequest) {
    const claims = await bearer(req, tokens);
    if (!claims || claims.kind !== 'platform') throw new HttpError(401, 'Bitte in der Steuerzentrale anmelden');
    req.claims = claims;
    req.platformUser = { id: claims.sub, email: '', name: 'CompanyGPT-Support' };
  }
  return { requireTenant, requireMember, requireAdmin, requirePlatform };
}
