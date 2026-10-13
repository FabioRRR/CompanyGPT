-- CompanyGPT · Grundschema
-- Mandantenfähigkeit: gemeinsame Datenbank, jede Kunden-Tabelle trägt tenant_id.
-- Row-Level Security (FORCE) trennt die Kunden auch dann, wenn ein Query-Filter fehlt.
-- Jede Anfrage setzt per Transaktion app.tenant_id (Kunde) oder app.platform = 'on' (Steuerzentrale).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE template_versions (
  version      text PRIMARY KEY CHECK (version ~ '^\d+\.\d+$'),
  notes        text[] NOT NULL DEFAULT '{}',
  published_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,30}$'),
  company          text NOT NULL,
  gpt_name         text NOT NULL,
  status           text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended')),
  template_version text NOT NULL REFERENCES template_versions (version),
  notice_version   text,
  brand            jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenants_version_idx ON tenants (template_version);

CREATE TABLE platform_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  email         text NOT NULL,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'member')),
  password_hash text,
  auth_provider text NOT NULL DEFAULT 'password',
  seen_version  text,
  last_active_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX members_email_idx ON members (tenant_id, lower(email));

CREATE TABLE invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin', 'member')),
  invited_by  text NOT NULL,
  message     text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  token_hash  text NOT NULL UNIQUE,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz
);
CREATE INDEX invites_tenant_idx ON invites (tenant_id, status);

CREATE TABLE collections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  key           text NOT NULL,
  name          text NOT NULL,
  gpt_enabled   boolean NOT NULL DEFAULT true,
  member_access boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, key)
);

CREATE TABLE connections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  app           text NOT NULL,
  name          text NOT NULL,
  auth          text NOT NULL CHECK (auth IN ('delegated', 'service', 'none')),
  areas         text[] NOT NULL DEFAULT '{}',
  collection_id uuid NOT NULL REFERENCES collections (id),
  permission    text NOT NULL CHECK (permission IN ('read', 'write')),
  actions       text[] NOT NULL DEFAULT '{}',
  security      jsonb NOT NULL,
  sync          text NOT NULL DEFAULT 'hourly' CHECK (sync IN ('realtime', 'hourly', 'daily')),
  state         text NOT NULL DEFAULT 'new' CHECK (state IN ('live', 'new', 'changed', 'removed')),
  last_sync_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX connections_tenant_idx ON connections (tenant_id);

CREATE TABLE sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('file', 'web', 'note', 'app')),
  name          text NOT NULL,
  collection_id uuid NOT NULL REFERENCES collections (id),
  state         text NOT NULL DEFAULT 'new' CHECK (state IN ('live', 'new', 'changed', 'deleted')),
  prev_state    text,
  index_status  text NOT NULL DEFAULT 'pending' CHECK (index_status IN ('pending', 'indexing', 'indexed', 'failed')),
  content       text,
  url           text,
  storage_key   text,
  size_bytes    bigint,
  connection_id uuid REFERENCES connections (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sources_tenant_state_idx ON sources (tenant_id, state);

-- Vektor-Abschnitte: nach Mandant hash-partitioniert, damit Index und Suche pro Kunde klein bleiben.
CREATE TABLE chunks (
  tenant_id     uuid NOT NULL,
  id            bigint GENERATED ALWAYS AS IDENTITY,
  source_id     uuid NOT NULL,
  collection_id uuid NOT NULL,
  content       text NOT NULL,
  embedding     vector(1024) NOT NULL,
  live          boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, id)
) PARTITION BY HASH (tenant_id);

DO $$
BEGIN
  FOR i IN 0..15 LOOP
    EXECUTE format('CREATE TABLE chunks_p%s PARTITION OF chunks FOR VALUES WITH (MODULUS 16, REMAINDER %s)', i, i);
  END LOOP;
END $$;

CREATE INDEX chunks_source_idx ON chunks (tenant_id, source_id);
CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE SEQUENCE ticket_number_seq START 1001;

CREATE TABLE tickets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number         bigint NOT NULL UNIQUE DEFAULT nextval('ticket_number_seq'),
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  member_id      uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  member_name    text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('problem', 'question', 'wish')),
  subject        text NOT NULL,
  priority       text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status         text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'open', 'waiting', 'solved')),
  context        text NOT NULL DEFAULT '',
  unread_support boolean NOT NULL DEFAULT true,
  unread_user    boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_status_idx ON tickets (status, updated_at DESC);
CREATE INDEX tickets_tenant_idx ON tickets (tenant_id, member_id);

CREATE TABLE ticket_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  ticket_id   uuid NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  author      text NOT NULL CHECK (author IN ('user', 'support')),
  author_name text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_messages_ticket_idx ON ticket_messages (ticket_id, created_at);

CREATE TABLE activity (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  uuid REFERENCES tenants (id) ON DELETE CASCADE,
  text       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_created_idx ON activity (created_at DESC);

-- Row-Level Security für alle Kunden-Tabellen
CREATE FUNCTION app_tenant() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE FUNCTION app_platform() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce(current_setting('app.platform', true), '') = 'on' $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['members', 'invites', 'collections', 'connections', 'sources', 'chunks', 'tickets', 'ticket_messages', 'activity'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_platform() OR tenant_id = app_tenant()) WITH CHECK (app_platform() OR tenant_id = app_tenant())', t);
  END LOOP;
END $$;
