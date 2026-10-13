import pg from 'pg';
import type { Collection, Connection, Invite, Member, ReleasePlan, Source, Tenant, TemplateVersion, Ticket, TicketMessage } from '@companygpt/core';
import { NotFoundError, type NewTenant, type PlatformUser, type Store, type TenantSummary } from './types';

type Ctx = { tenantId: string } | { platform: true };
type Row = Record<string, any>;

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d == null ? null : String(d));
const vec = (v: number[]) => `[${v.join(',')}]`;

const toTenant = (r: Row): Tenant => ({
  id: r.id, slug: r.slug, company: r.company, gptName: r.gpt_name, status: r.status, templateVersion: r.template_version,
  noticeVersion: r.notice_version, brand: r.brand ?? { primary: '#0040C4' }, createdAt: iso(r.created_at)!
});
const toMember = (r: Row): Member => ({
  id: r.id, tenantId: r.tenant_id, name: r.name, email: r.email, role: r.role, passwordHash: r.password_hash, seenVersion: r.seen_version, createdAt: iso(r.created_at)!
});
const toInvite = (r: Row): Invite => ({
  id: r.id, tenantId: r.tenant_id, email: r.email, role: r.role, invitedBy: r.invited_by, message: r.message, status: r.status,
  tokenHash: r.token_hash, sentAt: iso(r.sent_at)!, expiresAt: iso(r.expires_at)!
});
const toCollection = (r: Row): Collection => ({ id: r.id, tenantId: r.tenant_id, key: r.key, name: r.name, gptEnabled: r.gpt_enabled, memberAccess: r.member_access });
const toSource = (r: Row): Source => ({
  id: r.id, tenantId: r.tenant_id, kind: r.kind, name: r.name, collectionId: r.collection_id, state: r.state, prevState: r.prev_state,
  indexStatus: r.index_status, content: r.content, url: r.url, sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
  connectionId: r.connection_id, updatedAt: iso(r.updated_at)!
});
const toConnection = (r: Row): Connection => ({
  id: r.id, tenantId: r.tenant_id, app: r.app, name: r.name, auth: r.auth, areas: r.areas, collectionId: r.collection_id, permission: r.permission,
  actions: r.actions, security: r.security, sync: r.sync, state: r.state, lastSyncAt: iso(r.last_sync_at)
});
const toMessage = (r: Row): TicketMessage => ({ id: r.id, author: r.author, authorName: r.author_name, body: r.body, createdAt: iso(r.created_at)! });
const toTicket = (r: Row, messages: TicketMessage[]): Ticket => ({
  id: r.id, number: Number(r.number), tenantId: r.tenant_id, memberId: r.member_id, memberName: r.member_name, kind: r.kind, subject: r.subject,
  priority: r.priority, status: r.status, context: r.context, unreadSupport: r.unread_support, unreadUser: r.unread_user,
  createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!, messages
});

/** Spaltennamen in camelCase → snake_case für dynamische Updates (nur erlaubte Felder). */
function updateSql(table: string, patch: Record<string, unknown>, allowed: Record<string, string>, where: string, startIndex: number) {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || !(k in allowed)) continue;
    values.push(v);
    sets.push(`${allowed[k]} = $${startIndex + values.length - 1}`);
  }
  return { sql: sets.length ? `UPDATE ${table} SET ${sets.join(', ')} WHERE ${where} RETURNING *` : null, values };
}

export class PostgresStore implements Store {
  readonly pool: pg.Pool;

  constructor(connectionString: string, max = 10) {
    this.pool = new pg.Pool({ connectionString, max });
  }

  async close() { await this.pool.end(); }

  /** Jede Operation läuft in einer Transaktion mit gesetztem RLS-Kontext. */
  async tx<T>(ctx: Ctx, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      if ('tenantId' in ctx) await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctx.tenantId]);
      else await c.query(`SELECT set_config('app.platform', 'on', true)`);
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  private one<T>(rows: Row[], map: (r: Row) => T, what: string): T {
    if (!rows[0]) throw new NotFoundError(what);
    return map(rows[0]);
  }

  private P = { platform: true } as const;
  private T = (tenantId: string) => ({ tenantId });

  // Plattform
  async latestTemplate(): Promise<TemplateVersion> {
    const { rows } = await this.pool.query(`SELECT * FROM template_versions ORDER BY string_to_array(version, '.')::int[] DESC LIMIT 1`);
    return this.one(rows, (r) => ({ version: r.version, notes: r.notes, publishedAt: iso(r.published_at)! }), 'Vorlage');
  }
  async listTemplates(): Promise<TemplateVersion[]> {
    const { rows } = await this.pool.query(`SELECT * FROM template_versions ORDER BY string_to_array(version, '.')::int[] DESC`);
    return rows.map((r) => ({ version: r.version, notes: r.notes, publishedAt: iso(r.published_at)! }));
  }
  async publishTemplate(version: string, notes: string[]) {
    const { rows } = await this.pool.query(`INSERT INTO template_versions (version, notes) VALUES ($1, $2) RETURNING *`, [version, notes]);
    return { version: rows[0].version, notes: rows[0].notes, publishedAt: iso(rows[0].published_at)! };
  }
  async listTenants(): Promise<TenantSummary[]> {
    return this.tx(this.P, async (c) => {
      const { rows } = await c.query(`
        SELECT t.*,
          (SELECT count(*) FROM members m WHERE m.tenant_id = t.id) AS n_members,
          (SELECT count(*) FROM invites i WHERE i.tenant_id = t.id AND i.status = 'pending') AS n_invites,
          (SELECT count(*) FROM sources s WHERE s.tenant_id = t.id AND s.state <> 'deleted') AS n_sources,
          (SELECT count(*) FROM connections k WHERE k.tenant_id = t.id AND k.state <> 'removed') AS n_connections,
          (SELECT count(*) FROM tickets x WHERE x.tenant_id = t.id AND x.status <> 'solved') AS n_tickets
        FROM tenants t ORDER BY t.created_at`);
      return rows.map((r) => ({ ...toTenant(r), members: Number(r.n_members), pendingInvites: Number(r.n_invites), sources: Number(r.n_sources), connections: Number(r.n_connections), openTickets: Number(r.n_tickets) }));
    });
  }
  async getTenant(id: string) {
    const { rows } = await this.pool.query(`SELECT * FROM tenants WHERE id = $1`, [id]);
    return rows[0] ? toTenant(rows[0]) : null;
  }
  async getTenantBySlug(slug: string) {
    const { rows } = await this.pool.query(`SELECT * FROM tenants WHERE slug = $1`, [slug]);
    return rows[0] ? toTenant(rows[0]) : null;
  }
  async createTenant(input: NewTenant) {
    return this.tx(this.P, async (c) => {
      let r: Row;
      try {
        ({ rows: [r] } = await c.query(
          `INSERT INTO tenants (slug, company, gpt_name, template_version, brand) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [input.slug, input.company, input.gptName, input.templateVersion, input.brand]));
      } catch (e: any) {
        if (e.code === '23505') throw new Error('slug_taken');
        throw e;
      }
      for (const col of input.collections) {
        await c.query(`INSERT INTO collections (tenant_id, key, name, gpt_enabled, member_access) VALUES ($1, $2, $3, $4, $5)`,
          [r.id, col.key, col.name, col.gptEnabled, col.memberAccess]);
      }
      return toTenant(r);
    });
  }
  async updateTenant(id: string, patch: Partial<Tenant>) {
    const u = updateSql('tenants', { ...patch, updatedAt: new Date() }, { company: 'company', gptName: 'gpt_name', brand: 'brand', status: 'status', templateVersion: 'template_version', noticeVersion: 'notice_version', updatedAt: 'updated_at' }, 'id = $1', 2);
    const { rows } = await this.pool.query(u.sql!, [id, ...u.values]);
    return this.one(rows, toTenant, 'Kunde');
  }
  async findPlatformUser(email: string): Promise<PlatformUser | null> {
    const { rows } = await this.pool.query(`SELECT * FROM platform_users WHERE email = lower($1)`, [email]);
    return rows[0] ? { id: rows[0].id, email: rows[0].email, name: rows[0].name, passwordHash: rows[0].password_hash } : null;
  }
  async createPlatformUser(email: string, name: string, passwordHash: string) {
    const { rows } = await this.pool.query(`INSERT INTO platform_users (email, name, password_hash) VALUES (lower($1), $2, $3) RETURNING *`, [email, name, passwordHash]);
    return { id: rows[0].id, email: rows[0].email, name: rows[0].name, passwordHash: rows[0].password_hash };
  }
  async logActivity(tenantId: string | null, text: string) {
    await this.tx(this.P, (c) => c.query(`INSERT INTO activity (tenant_id, text) VALUES ($1, $2)`, [tenantId, text]));
  }
  async listActivity(limit: number) {
    return this.tx(this.P, async (c) => {
      const { rows } = await c.query(`SELECT * FROM activity ORDER BY created_at DESC, id DESC LIMIT $1`, [limit]);
      return rows.map((r) => ({ tenantId: r.tenant_id, text: r.text, createdAt: iso(r.created_at)! }));
    });
  }

  // Team
  async listMembers(tid: string) {
    return this.tx(this.T(tid), async (c) => (await c.query(`SELECT * FROM members WHERE tenant_id = $1 ORDER BY created_at`, [tid])).rows.map(toMember));
  }
  async getMember(tid: string, id: string) {
    return this.tx(this.T(tid), async (c) => { const r = (await c.query(`SELECT * FROM members WHERE id = $1`, [id])).rows[0]; return r ? toMember(r) : null; });
  }
  async findMemberByEmail(tid: string, email: string) {
    return this.tx(this.T(tid), async (c) => { const r = (await c.query(`SELECT * FROM members WHERE lower(email) = lower($1)`, [email])).rows[0]; return r ? toMember(r) : null; });
  }
  async createMember(tid: string, input: { name: string; email: string; role: Member['role']; passwordHash: string | null }) {
    return this.tx(this.T(tid), async (c) => {
      try {
        const { rows } = await c.query(`INSERT INTO members (tenant_id, name, email, role, password_hash) VALUES ($1, $2, lower($3), $4, $5) RETURNING *`, [tid, input.name, input.email, input.role, input.passwordHash]);
        return toMember(rows[0]);
      } catch (e: any) {
        if (e.code === '23505') throw new Error('member_exists');
        throw e;
      }
    });
  }
  async updateMember(tid: string, id: string, patch: Partial<Member>) {
    const u = updateSql('members', patch, { name: 'name', role: 'role', passwordHash: 'password_hash', seenVersion: 'seen_version' }, 'id = $1', 2);
    if (!u.sql) return (await this.getMember(tid, id))!;
    return this.tx(this.T(tid), async (c) => this.one((await c.query(u.sql!, [id, ...u.values])).rows, toMember, 'Mitglied'));
  }
  async deleteMember(tid: string, id: string) {
    await this.tx(this.T(tid), (c) => c.query(`DELETE FROM members WHERE id = $1`, [id]));
  }
  async listInvites(tid: string) {
    return this.tx(this.T(tid), async (c) => (await c.query(`SELECT * FROM invites ORDER BY sent_at DESC`)).rows.map(toInvite));
  }
  async createInvite(tid: string, input: Omit<Invite, 'id' | 'tenantId' | 'status' | 'sentAt'>) {
    return this.tx(this.T(tid), async (c) => toInvite((await c.query(
      `INSERT INTO invites (tenant_id, email, role, invited_by, message, token_hash, expires_at) VALUES ($1, lower($2), $3, $4, $5, $6, $7) RETURNING *`,
      [tid, input.email, input.role, input.invitedBy, input.message, input.tokenHash, input.expiresAt])).rows[0]));
  }
  async updateInvite(tid: string, id: string, patch: Partial<Invite>) {
    const u = updateSql('invites', { ...patch, acceptedAt: patch.status === 'accepted' ? new Date() : undefined },
      { status: 'status', tokenHash: 'token_hash', sentAt: 'sent_at', expiresAt: 'expires_at', message: 'message', role: 'role', acceptedAt: 'accepted_at' }, 'id = $1', 2);
    return this.tx(this.T(tid), async (c) => this.one((await c.query(u.sql!, [id, ...u.values])).rows, toInvite, 'Einladung'));
  }
  async findInviteByTokenHash(hash: string) {
    return this.tx(this.P, async (c) => { const r = (await c.query(`SELECT * FROM invites WHERE token_hash = $1`, [hash])).rows[0]; return r ? toInvite(r) : null; });
  }

  // Wissen
  async listCollections(tid: string) {
    return this.tx(this.T(tid), async (c) => (await c.query(`SELECT * FROM collections ORDER BY key`)).rows.map(toCollection));
  }
  async updateCollection(tid: string, id: string, patch: Partial<Collection>) {
    const u = updateSql('collections', patch, { name: 'name', gptEnabled: 'gpt_enabled', memberAccess: 'member_access' }, 'id = $1', 2);
    return this.tx(this.T(tid), async (c) => this.one((await c.query(u.sql!, [id, ...u.values])).rows, toCollection, 'Sammlung'));
  }
  async listSources(tid: string) {
    return this.tx(this.T(tid), async (c) => (await c.query(`SELECT * FROM sources ORDER BY updated_at DESC`)).rows.map(toSource));
  }
  async getSource(tid: string, id: string) {
    return this.tx(this.T(tid), async (c) => { const r = (await c.query(`SELECT * FROM sources WHERE id = $1`, [id])).rows[0]; return r ? toSource(r) : null; });
  }
  async createSource(tid: string, input: Pick<Source, 'kind' | 'name' | 'collectionId'> & Partial<Source>) {
    return this.tx(this.T(tid), async (c) => toSource((await c.query(
      `INSERT INTO sources (tenant_id, kind, name, collection_id, content, url, size_bytes, connection_id, state) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [tid, input.kind, input.name, input.collectionId, input.content ?? null, input.url ?? null, input.sizeBytes ?? null, input.connectionId ?? null, input.state ?? 'new'])).rows[0]));
  }
  async updateSource(tid: string, id: string, patch: Partial<Source>) {
    const u = updateSql('sources', { ...patch, updatedAt: new Date() },
      { name: 'name', collectionId: 'collection_id', state: 'state', prevState: 'prev_state', indexStatus: 'index_status', content: 'content', sizeBytes: 'size_bytes', updatedAt: 'updated_at' }, 'id = $1', 2);
    return this.tx(this.T(tid), async (c) => this.one((await c.query(u.sql!, [id, ...u.values])).rows, toSource, 'Quelle'));
  }
  async deleteSource(tid: string, id: string) {
    await this.tx(this.T(tid), async (c) => {
      await c.query(`DELETE FROM chunks WHERE tenant_id = $1 AND source_id = $2`, [tid, id]);
      await c.query(`DELETE FROM sources WHERE id = $1`, [id]);
    });
  }
  async replaceDraftChunks(tid: string, sourceId: string, collectionId: string, chunks: { content: string; embedding: number[] }[]) {
    await this.tx(this.T(tid), async (c) => {
      await c.query(`DELETE FROM chunks WHERE tenant_id = $1 AND source_id = $2 AND NOT live`, [tid, sourceId]);
      for (let i = 0; i < chunks.length; i += 200) {
        const part = chunks.slice(i, i + 200);
        const values: unknown[] = [];
        const rows = part.map((ch, j) => {
          values.push(tid, sourceId, collectionId, ch.content, vec(ch.embedding));
          const b = j * 5;
          return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}::vector)`;
        });
        await c.query(`INSERT INTO chunks (tenant_id, source_id, collection_id, content, embedding) VALUES ${rows.join(', ')}`, values);
      }
    });
  }
  async applyRelease(tid: string, plan: ReleasePlan) {
    await this.tx(this.T(tid), async (c) => {
      if (plan.publish.length) {
        // Alte Live-Abschnitte nur ersetzen, wenn neue Entwürfe existieren
        await c.query(`
          DELETE FROM chunks l WHERE l.tenant_id = $1 AND l.live AND l.source_id = ANY($2::uuid[])
            AND EXISTS (SELECT 1 FROM chunks d WHERE d.tenant_id = $1 AND d.source_id = l.source_id AND NOT d.live)`, [tid, plan.publish]);
        await c.query(`
          UPDATE chunks ch SET live = true, collection_id = s.collection_id
          FROM sources s WHERE ch.tenant_id = $1 AND s.id = ch.source_id AND ch.source_id = ANY($2::uuid[])`, [tid, plan.publish]);
        await c.query(`UPDATE sources SET state = 'live', prev_state = NULL, updated_at = now() WHERE id = ANY($1::uuid[])`, [plan.publish]);
      }
      if (plan.purge.length) {
        await c.query(`DELETE FROM chunks WHERE tenant_id = $1 AND source_id = ANY($2::uuid[])`, [tid, plan.purge]);
        await c.query(`DELETE FROM sources WHERE id = ANY($1::uuid[])`, [plan.purge]);
      }
    });
  }
  async searchChunks(tid: string, embedding: number[], collectionIds: string[], limit: number) {
    if (!collectionIds.length) return [];
    return this.tx(this.T(tid), async (c) => {
      const { rows } = await c.query(`
        SELECT source_id, content, 1 - (embedding <=> $2::vector) AS score
        FROM chunks WHERE tenant_id = $1 AND live AND collection_id = ANY($3::uuid[])
        ORDER BY embedding <=> $2::vector LIMIT $4`, [tid, vec(embedding), collectionIds, limit]);
      return rows.map((r) => ({ sourceId: r.source_id, content: r.content, score: Number(r.score) }));
    });
  }

  // Apps
  async listConnections(tid: string) {
    return this.tx(this.T(tid), async (c) => (await c.query(`SELECT * FROM connections ORDER BY created_at`)).rows.map(toConnection));
  }
  async getConnection(tid: string, id: string) {
    return this.tx(this.T(tid), async (c) => { const r = (await c.query(`SELECT * FROM connections WHERE id = $1`, [id])).rows[0]; return r ? toConnection(r) : null; });
  }
  async createConnection(tid: string, i: Omit<Connection, 'id' | 'tenantId' | 'state' | 'lastSyncAt'>) {
    return this.tx(this.T(tid), async (c) => toConnection((await c.query(
      `INSERT INTO connections (tenant_id, app, name, auth, areas, collection_id, permission, actions, security, sync) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [tid, i.app, i.name, i.auth, i.areas, i.collectionId, i.permission, i.actions, i.security, i.sync])).rows[0]));
  }
  async updateConnection(tid: string, id: string, patch: Partial<Connection>) {
    const u = updateSql('connections', patch, { name: 'name', auth: 'auth', areas: 'areas', collectionId: 'collection_id', permission: 'permission', actions: 'actions', security: 'security', sync: 'sync', state: 'state', lastSyncAt: 'last_sync_at' }, 'id = $1', 2);
    return this.tx(this.T(tid), async (c) => this.one((await c.query(u.sql!, [id, ...u.values])).rows, toConnection, 'Verbindung'));
  }

  // Support
  private async loadTickets(c: pg.PoolClient, rows: Row[]): Promise<Ticket[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const { rows: msgs } = await c.query(`SELECT * FROM ticket_messages WHERE ticket_id = ANY($1::uuid[]) ORDER BY created_at, id`, [ids]);
    return rows.map((r) => toTicket(r, msgs.filter((m) => m.ticket_id === r.id).map(toMessage)));
  }
  private ctxFor(tid?: string): Ctx { return tid ? this.T(tid) : this.P; }

  async createTicket(tid: string, i: { memberId: string; memberName: string; kind: Ticket['kind']; subject: string; priority: Ticket['priority']; context: string; body: string }) {
    return this.tx(this.T(tid), async (c) => {
      const { rows } = await c.query(
        `INSERT INTO tickets (tenant_id, member_id, member_name, kind, subject, priority, context) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [tid, i.memberId, i.memberName, i.kind, i.subject, i.priority, i.context]);
      await c.query(`INSERT INTO ticket_messages (tenant_id, ticket_id, author, author_name, body) VALUES ($1, $2, 'user', $3, $4)`, [tid, rows[0].id, i.memberName, i.body]);
      return (await this.loadTickets(c, rows))[0];
    });
  }
  async listTickets(f: { tenantId?: string; memberId?: string; status?: Ticket['status'][] }) {
    return this.tx(this.ctxFor(f.tenantId), async (c) => {
      const where: string[] = [];
      const values: unknown[] = [];
      if (f.tenantId) { values.push(f.tenantId); where.push(`tenant_id = $${values.length}`); }
      if (f.memberId) { values.push(f.memberId); where.push(`member_id = $${values.length}`); }
      if (f.status) { values.push(f.status); where.push(`status = ANY($${values.length}::text[])`); }
      const { rows } = await c.query(`SELECT * FROM tickets ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT 500`, values);
      return this.loadTickets(c, rows);
    });
  }
  async getTicket(id: string, tid?: string) {
    return this.tx(this.ctxFor(tid), async (c) => (await this.loadTickets(c, (await c.query(`SELECT * FROM tickets WHERE id = $1`, [id])).rows))[0] ?? null);
  }
  async addTicketMessage(id: string, tid: string | undefined, msg: { author: 'user' | 'support'; authorName: string; body: string }, patch: Partial<Ticket>) {
    return this.tx(this.ctxFor(tid), async (c) => {
      const t = (await c.query(`SELECT * FROM tickets WHERE id = $1`, [id])).rows[0];
      if (!t) throw new NotFoundError('Anfrage');
      await c.query(`INSERT INTO ticket_messages (tenant_id, ticket_id, author, author_name, body) VALUES ($1, $2, $3, $4, $5)`, [t.tenant_id, id, msg.author, msg.authorName, msg.body]);
      return this.patchTicket(c, id, patch);
    });
  }
  async updateTicket(id: string, tid: string | undefined, patch: Partial<Ticket>) {
    return this.tx(this.ctxFor(tid), (c) => this.patchTicket(c, id, patch));
  }
  private async patchTicket(c: pg.PoolClient, id: string, patch: Partial<Ticket>) {
    const u = updateSql('tickets', { ...patch, updatedAt: new Date() }, { status: 'status', priority: 'priority', unreadSupport: 'unread_support', unreadUser: 'unread_user', updatedAt: 'updated_at' }, 'id = $1', 2);
    const { rows } = await c.query(u.sql!, [id, ...u.values]);
    if (!rows[0]) throw new NotFoundError('Anfrage');
    return (await this.loadTickets(c, rows))[0];
  }
}
