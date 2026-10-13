import type {
  Brand, Collection, Connection, Invite, Member, ReleasePlan, Role, Source, Tenant, TemplateVersion, Ticket,
  TicketKind, TicketMessage, TicketPriority, TicketStatus
} from '@companygpt/core';

export interface TenantSummary extends Tenant {
  members: number;
  pendingInvites: number;
  sources: number;
  connections: number;
  openTickets: number;
}

export interface NewTenant {
  slug: string;
  company: string;
  gptName: string;
  brand: Brand;
  templateVersion: string;
  collections: { key: string; name: string; gptEnabled: boolean; memberAccess: boolean }[];
}

export interface PlatformUser { id: string; email: string; name: string; passwordHash: string }

export interface SearchHit { sourceId: string; content: string; score: number }

export type TenantPatch = Partial<Pick<Tenant, 'company' | 'gptName' | 'brand' | 'status' | 'templateVersion' | 'noticeVersion'>>;
export type MemberPatch = Partial<Pick<Member, 'name' | 'role' | 'passwordHash' | 'seenVersion'>>;
export type InvitePatch = Partial<Pick<Invite, 'status' | 'tokenHash' | 'sentAt' | 'expiresAt' | 'message' | 'role'>>;
export type SourcePatch = Partial<Pick<Source, 'name' | 'collectionId' | 'state' | 'prevState' | 'indexStatus' | 'content' | 'sizeBytes'>>;
export type ConnectionPatch = Partial<Omit<Connection, 'id' | 'tenantId' | 'app'>>;
export type TicketPatch = Partial<Pick<Ticket, 'status' | 'priority' | 'unreadSupport' | 'unreadUser'>>;

/**
 * Speicher-Schnittstelle. Jede Kunden-Operation bekommt die tenantId explizit –
 * die Postgres-Implementierung setzt sie zusätzlich als RLS-Kontext.
 */
export interface Store {
  close(): Promise<void>;

  // Plattform
  latestTemplate(): Promise<TemplateVersion>;
  listTemplates(): Promise<TemplateVersion[]>;
  publishTemplate(version: string, notes: string[]): Promise<TemplateVersion>;
  listTenants(): Promise<TenantSummary[]>;
  getTenant(id: string): Promise<Tenant | null>;
  getTenantBySlug(slug: string): Promise<Tenant | null>;
  createTenant(input: NewTenant): Promise<Tenant>;
  updateTenant(id: string, patch: TenantPatch): Promise<Tenant>;
  findPlatformUser(email: string): Promise<PlatformUser | null>;
  createPlatformUser(email: string, name: string, passwordHash: string): Promise<PlatformUser>;
  logActivity(tenantId: string | null, text: string): Promise<void>;
  listActivity(limit: number): Promise<{ tenantId: string | null; text: string; createdAt: string }[]>;

  // Team
  listMembers(tenantId: string): Promise<Member[]>;
  getMember(tenantId: string, id: string): Promise<Member | null>;
  findMemberByEmail(tenantId: string, email: string): Promise<Member | null>;
  createMember(tenantId: string, input: { name: string; email: string; role: Role; passwordHash: string | null }): Promise<Member>;
  updateMember(tenantId: string, id: string, patch: MemberPatch): Promise<Member>;
  deleteMember(tenantId: string, id: string): Promise<void>;
  listInvites(tenantId: string): Promise<Invite[]>;
  createInvite(tenantId: string, input: Omit<Invite, 'id' | 'tenantId' | 'status' | 'sentAt'>): Promise<Invite>;
  updateInvite(tenantId: string, id: string, patch: InvitePatch): Promise<Invite>;
  /** Mandantenübergreifend – nur für das Annehmen über den Einladungslink */
  findInviteByTokenHash(tokenHash: string): Promise<Invite | null>;

  // Wissen
  listCollections(tenantId: string): Promise<Collection[]>;
  updateCollection(tenantId: string, id: string, patch: Partial<Pick<Collection, 'name' | 'gptEnabled' | 'memberAccess'>>): Promise<Collection>;
  listSources(tenantId: string): Promise<Source[]>;
  getSource(tenantId: string, id: string): Promise<Source | null>;
  createSource(tenantId: string, input: Pick<Source, 'kind' | 'name' | 'collectionId'> & Partial<Pick<Source, 'content' | 'url' | 'sizeBytes' | 'connectionId' | 'state'>>): Promise<Source>;
  updateSource(tenantId: string, id: string, patch: SourcePatch): Promise<Source>;
  deleteSource(tenantId: string, id: string): Promise<void>;
  /** Ersetzt die Entwurfs-Abschnitte einer Quelle (noch nicht live). */
  replaceDraftChunks(tenantId: string, sourceId: string, collectionId: string, chunks: { content: string; embedding: number[] }[]): Promise<void>;
  /** „Wissen freigeben“ atomar: Entwürfe live schalten, Markiertes endgültig entfernen. */
  applyRelease(tenantId: string, plan: ReleasePlan): Promise<void>;
  searchChunks(tenantId: string, embedding: number[], collectionIds: string[], limit: number): Promise<SearchHit[]>;

  // Apps
  listConnections(tenantId: string): Promise<Connection[]>;
  getConnection(tenantId: string, id: string): Promise<Connection | null>;
  createConnection(tenantId: string, input: Omit<Connection, 'id' | 'tenantId' | 'state' | 'lastSyncAt'>): Promise<Connection>;
  updateConnection(tenantId: string, id: string, patch: ConnectionPatch): Promise<Connection>;

  // Support
  createTicket(tenantId: string, input: { memberId: string; memberName: string; kind: TicketKind; subject: string; priority: TicketPriority; context: string; body: string }): Promise<Ticket>;
  /** tenantId weglassen = Plattform-Sicht über alle Kunden */
  listTickets(filter: { tenantId?: string; memberId?: string; status?: TicketStatus[] }): Promise<Ticket[]>;
  getTicket(id: string, tenantId?: string): Promise<Ticket | null>;
  addTicketMessage(id: string, tenantId: string | undefined, msg: Pick<TicketMessage, 'author' | 'authorName' | 'body'>, patch: TicketPatch): Promise<Ticket>;
  updateTicket(id: string, tenantId: string | undefined, patch: TicketPatch): Promise<Ticket>;
}

export class NotFoundError extends Error {
  constructor(what: string) { super(`${what} nicht gefunden`); }
}
