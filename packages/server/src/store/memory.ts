import { randomUUID } from 'node:crypto';
import type { Collection, Connection, Invite, Member, ReleasePlan, Source, Tenant, TemplateVersion, Ticket } from '@companygpt/core';
import { NotFoundError, type NewTenant, type PlatformUser, type Store, type TenantSummary } from './types';

const now = () => new Date().toISOString();

interface Chunk { tenantId: string; sourceId: string; collectionId: string; content: string; embedding: number[]; live: boolean }

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** In-Memory-Speicher für Entwicklung und Tests. Gleiche Semantik wie Postgres, aber nicht persistent. */
export class MemoryStore implements Store {
  private templates: TemplateVersion[] = [{ version: '1.0', notes: ['Erste Version'], publishedAt: now() }];
  private tenants: Tenant[] = [];
  private platformUsers: PlatformUser[] = [];
  private members: Member[] = [];
  private invites: Invite[] = [];
  private collections: Collection[] = [];
  private sources: Source[] = [];
  private chunks: Chunk[] = [];
  private connections: Connection[] = [];
  private tickets: Ticket[] = [];
  private activity: { tenantId: string | null; text: string; createdAt: string }[] = [];
  private ticketNo = 1001;

  async close() {}

  private must<T>(v: T | null | undefined, what: string): T { if (!v) throw new NotFoundError(what); return v; }
  private patch<T extends object>(list: T[], pred: (x: T) => boolean, patch: Partial<T>, what: string): T {
    const i = list.findIndex(pred);
    if (i < 0) throw new NotFoundError(what);
    list[i] = { ...list[i], ...patch };
    return list[i];
  }

  // Plattform
  async latestTemplate() { return this.templates[this.templates.length - 1]; }
  async listTemplates() { return [...this.templates].reverse(); }
  async publishTemplate(version: string, notes: string[]) {
    const t = { version, notes, publishedAt: now() };
    this.templates.push(t);
    return t;
  }
  async listTenants(): Promise<TenantSummary[]> {
    return this.tenants.map((t) => ({
      ...t,
      members: this.members.filter((m) => m.tenantId === t.id).length,
      pendingInvites: this.invites.filter((i) => i.tenantId === t.id && i.status === 'pending').length,
      sources: this.sources.filter((s) => s.tenantId === t.id && s.state !== 'deleted').length,
      connections: this.connections.filter((c) => c.tenantId === t.id && c.state !== 'removed').length,
      openTickets: this.tickets.filter((k) => k.tenantId === t.id && k.status !== 'solved').length
    }));
  }
  async getTenant(id: string) { return this.tenants.find((t) => t.id === id) ?? null; }
  async getTenantBySlug(slug: string) { return this.tenants.find((t) => t.slug === slug) ?? null; }
  async createTenant(input: NewTenant) {
    if (this.tenants.some((t) => t.slug === input.slug)) throw new Error('slug_taken');
    const t: Tenant = { id: randomUUID(), slug: input.slug, company: input.company, gptName: input.gptName, status: 'invited', templateVersion: input.templateVersion, noticeVersion: null, brand: input.brand, createdAt: now() };
    this.tenants.push(t);
    for (const c of input.collections) this.collections.push({ id: randomUUID(), tenantId: t.id, ...c });
    return t;
  }
  async updateTenant(id: string, patch: Partial<Tenant>) { return this.patch(this.tenants, (t) => t.id === id, patch, 'Kunde'); }
  async findPlatformUser(email: string) { return this.platformUsers.find((u) => u.email === email.toLowerCase()) ?? null; }
  async createPlatformUser(email: string, name: string, passwordHash: string) {
    const u = { id: randomUUID(), email: email.toLowerCase(), name, passwordHash };
    this.platformUsers.push(u);
    return u;
  }
  async logActivity(tenantId: string | null, text: string) { this.activity.unshift({ tenantId, text, createdAt: now() }); }
  async listActivity(limit: number) { return this.activity.slice(0, limit); }

  // Team
  async listMembers(tid: string) { return this.members.filter((m) => m.tenantId === tid); }
  async getMember(tid: string, id: string) { return this.members.find((m) => m.tenantId === tid && m.id === id) ?? null; }
  async findMemberByEmail(tid: string, email: string) { return this.members.find((m) => m.tenantId === tid && m.email.toLowerCase() === email.toLowerCase()) ?? null; }
  async createMember(tid: string, input: { name: string; email: string; role: Member['role']; passwordHash: string | null }) {
    if (await this.findMemberByEmail(tid, input.email)) throw new Error('member_exists');
    const m: Member = { id: randomUUID(), tenantId: tid, name: input.name, email: input.email.toLowerCase(), role: input.role, passwordHash: input.passwordHash, seenVersion: null, createdAt: now() };
    this.members.push(m);
    return m;
  }
  async updateMember(tid: string, id: string, patch: Partial<Member>) { return this.patch(this.members, (m) => m.tenantId === tid && m.id === id, patch, 'Mitglied'); }
  async deleteMember(tid: string, id: string) { this.members = this.members.filter((m) => !(m.tenantId === tid && m.id === id)); }
  async listInvites(tid: string) { return this.invites.filter((i) => i.tenantId === tid).sort((a, b) => b.sentAt.localeCompare(a.sentAt)); }
  async createInvite(tid: string, input: Omit<Invite, 'id' | 'tenantId' | 'status' | 'sentAt'>) {
    const inv: Invite = { id: randomUUID(), tenantId: tid, status: 'pending', sentAt: now(), ...input };
    this.invites.push(inv);
    return inv;
  }
  async updateInvite(tid: string, id: string, patch: Partial<Invite>) { return this.patch(this.invites, (i) => i.tenantId === tid && i.id === id, patch, 'Einladung'); }
  async findInviteByTokenHash(hash: string) { return this.invites.find((i) => i.tokenHash === hash) ?? null; }

  // Wissen
  async listCollections(tid: string) { return this.collections.filter((c) => c.tenantId === tid); }
  async updateCollection(tid: string, id: string, patch: Partial<Collection>) { return this.patch(this.collections, (c) => c.tenantId === tid && c.id === id, patch, 'Sammlung'); }
  async listSources(tid: string) { return this.sources.filter((s) => s.tenantId === tid).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async getSource(tid: string, id: string) { return this.sources.find((s) => s.tenantId === tid && s.id === id) ?? null; }
  async createSource(tid: string, input: Pick<Source, 'kind' | 'name' | 'collectionId'> & Partial<Source>) {
    const s: Source = { id: randomUUID(), tenantId: tid, state: 'new', prevState: null, indexStatus: 'pending', content: null, url: null, sizeBytes: null, connectionId: null, updatedAt: now(), ...input };
    this.sources.push(s);
    return s;
  }
  async updateSource(tid: string, id: string, patch: Partial<Source>) { return this.patch(this.sources, (s) => s.tenantId === tid && s.id === id, { ...patch, updatedAt: now() }, 'Quelle'); }
  async deleteSource(tid: string, id: string) {
    this.sources = this.sources.filter((s) => !(s.tenantId === tid && s.id === id));
    this.chunks = this.chunks.filter((c) => !(c.tenantId === tid && c.sourceId === id));
  }
  async replaceDraftChunks(tid: string, sourceId: string, collectionId: string, chunks: { content: string; embedding: number[] }[]) {
    this.chunks = this.chunks.filter((c) => !(c.tenantId === tid && c.sourceId === sourceId && !c.live));
    for (const c of chunks) this.chunks.push({ tenantId: tid, sourceId, collectionId, content: c.content, embedding: c.embedding, live: false });
  }
  async applyRelease(tid: string, plan: ReleasePlan) {
    for (const id of plan.publish) {
      const src = this.must(this.sources.find((s) => s.tenantId === tid && s.id === id), 'Quelle');
      const hasDraft = this.chunks.some((c) => c.tenantId === tid && c.sourceId === id && !c.live);
      if (hasDraft) this.chunks = this.chunks.filter((c) => !(c.tenantId === tid && c.sourceId === id && c.live));
      for (const c of this.chunks) if (c.tenantId === tid && c.sourceId === id) { c.live = true; c.collectionId = src.collectionId; }
      Object.assign(src, { state: 'live', prevState: null, updatedAt: now() });
    }
    for (const id of plan.purge) await this.deleteSource(tid, id);
  }
  async searchChunks(tid: string, embedding: number[], collectionIds: string[], limit: number) {
    return this.chunks
      .filter((c) => c.tenantId === tid && c.live && collectionIds.includes(c.collectionId))
      .map((c) => ({ sourceId: c.sourceId, content: c.content, score: cosine(c.embedding, embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // Apps
  async listConnections(tid: string) { return this.connections.filter((c) => c.tenantId === tid); }
  async getConnection(tid: string, id: string) { return this.connections.find((c) => c.tenantId === tid && c.id === id) ?? null; }
  async createConnection(tid: string, input: Omit<Connection, 'id' | 'tenantId' | 'state' | 'lastSyncAt'>) {
    const c: Connection = { id: randomUUID(), tenantId: tid, state: 'new', lastSyncAt: null, ...input };
    this.connections.push(c);
    return c;
  }
  async updateConnection(tid: string, id: string, patch: Partial<Connection>) { return this.patch(this.connections, (c) => c.tenantId === tid && c.id === id, patch, 'Verbindung'); }

  // Support
  async createTicket(tid: string, input: { memberId: string; memberName: string; kind: Ticket['kind']; subject: string; priority: Ticket['priority']; context: string; body: string }) {
    const t: Ticket = {
      id: randomUUID(), number: this.ticketNo++, tenantId: tid, memberId: input.memberId, memberName: input.memberName, kind: input.kind,
      subject: input.subject, priority: input.priority, status: 'new', context: input.context, unreadSupport: true, unreadUser: false,
      createdAt: now(), updatedAt: now(),
      messages: [{ id: randomUUID(), author: 'user', authorName: input.memberName, body: input.body, createdAt: now() }]
    };
    this.tickets.push(t);
    return t;
  }
  async listTickets(f: { tenantId?: string; memberId?: string; status?: Ticket['status'][] }) {
    return this.tickets
      .filter((t) => (!f.tenantId || t.tenantId === f.tenantId) && (!f.memberId || t.memberId === f.memberId) && (!f.status || f.status.includes(t.status)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getTicket(id: string, tid?: string) { return this.tickets.find((t) => t.id === id && (!tid || t.tenantId === tid)) ?? null; }
  async addTicketMessage(id: string, tid: string | undefined, msg: { author: 'user' | 'support'; authorName: string; body: string }, patch: Partial<Ticket>) {
    const t = this.must(await this.getTicket(id, tid), 'Anfrage');
    t.messages.push({ id: randomUUID(), createdAt: now(), ...msg });
    Object.assign(t, patch, { updatedAt: now() });
    return t;
  }
  async updateTicket(id: string, tid: string | undefined, patch: Partial<Ticket>) {
    const t = this.must(await this.getTicket(id, tid), 'Anfrage');
    Object.assign(t, patch, { updatedAt: now() });
    return t;
  }
}
