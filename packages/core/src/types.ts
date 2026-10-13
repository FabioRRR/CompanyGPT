export type Role = 'admin' | 'member';
export type TenantStatus = 'invited' | 'active' | 'suspended';
export type SourceKind = 'file' | 'web' | 'note' | 'app';
/** Freigabe-Status: live = vom GPT genutzt, new/changed = wartet auf Freigabe, deleted = wird mit der nächsten Freigabe entfernt */
export type SourceState = 'live' | 'new' | 'changed' | 'deleted';
export type IndexStatus = 'pending' | 'indexing' | 'indexed' | 'failed';
export type ConnectionState = 'live' | 'new' | 'changed' | 'removed';
export type Permission = 'read' | 'write';
export type InviteStatus = 'pending' | 'accepted' | 'revoked';
export type TicketStatus = 'new' | 'open' | 'waiting' | 'solved';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketKind = 'problem' | 'question' | 'wish';

export interface Brand {
  primary: string;
  logoUrl?: string | null;
  markUrl?: string | null;
}

export interface Tenant {
  id: string;
  slug: string;
  company: string;
  gptName: string;
  status: TenantStatus;
  templateVersion: string;
  noticeVersion?: string | null;
  brand: Brand;
  createdAt: string;
}

export interface Member {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: Role;
  passwordHash?: string | null;
  seenVersion?: string | null;
  createdAt: string;
}

export interface Invite {
  id: string;
  tenantId: string;
  email: string;
  role: Role;
  invitedBy: string;
  message: string;
  status: InviteStatus;
  tokenHash: string;
  sentAt: string;
  expiresAt: string;
}

export interface Collection {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  gptEnabled: boolean;
  memberAccess: boolean;
}

export interface Source {
  id: string;
  tenantId: string;
  kind: SourceKind;
  name: string;
  collectionId: string;
  state: SourceState;
  prevState?: SourceState | null;
  indexStatus: IndexStatus;
  content?: string | null;
  url?: string | null;
  sizeBytes?: number | null;
  connectionId?: string | null;
  updatedAt: string;
}

export interface SecuritySettings {
  inheritPermissions: boolean;
  audit: boolean;
  rotateCredentials: boolean;
  excludeConfidential: boolean;
  confirmActions: boolean;
}

export interface Connection {
  id: string;
  tenantId: string;
  app: string;
  name: string;
  auth: 'delegated' | 'service' | 'none';
  areas: string[];
  collectionId: string;
  permission: Permission;
  actions: string[];
  security: SecuritySettings;
  sync: 'realtime' | 'hourly' | 'daily';
  state: ConnectionState;
  lastSyncAt?: string | null;
}

export interface TicketMessage {
  id: string;
  author: 'user' | 'support';
  authorName: string;
  body: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  number: number;
  tenantId: string;
  memberId: string;
  memberName: string;
  kind: TicketKind;
  subject: string;
  priority: TicketPriority;
  status: TicketStatus;
  context: string;
  unreadSupport: boolean;
  unreadUser: boolean;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
}

export interface TemplateVersion {
  version: string;
  publishedAt: string;
  notes: string[];
}
