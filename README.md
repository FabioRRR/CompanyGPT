# CompanyGPT

White-Label-Wissensassistent für Unternehmen. Jede Firma bekommt ein eigenes, gebrandetes Dashboard („Company“ steht als Platzhalter für die jeweilige Firma – z. B. **GantnerGPT** für Gantner Instruments). Über die **CompanyGPT-Steuerzentrale** werden alle Kunden-Dashboards angelegt, aktualisiert und betreut.

> **Stand 0.10.0:** klickbarer UX-Prototyp **plus** skalierbare, getestete Backend-Grundlage (API, Worker, Datenbank). Das Frontend ist noch der Prototyp.

## Was wo liegt
```
apps/
  api/        Zustandslose HTTP-API (Fastify): Kunden-Dashboards + Steuerzentrale
  worker/     Hintergrund-Jobs: Indexierung, App-Sync, E-Mails, Rollouts
packages/
  core/       Geschäftslogik ohne Abhängigkeiten (Rechte, Freigabe, Apps, Sicherheit, Versionen, Theme)
  server/     Speicher (Postgres/In-Memory), Warteschlange, KI-Anbieter, Jobs, Migrationen, Seed
db/migrations Schema mit Row-Level Security und partitionierter Vektorsuche (pgvector)
infra/        Dockerfile, docker-compose, Postgres-Init
prototype/    Klickbarer UX-Prototyp (Design-Component-Format)
docs/         ARCHITEKTUR.md, SKALIERUNG.md
```

## Schnellstart (Entwicklung)
```bash
npm install
npm run dev:api          # ohne Datenbank: In-Memory + Jobs im API-Prozess
```
API läuft auf `http://localhost:8080`. Kunde per Header `x-tenant: gantner` oder Subdomain `gantner.<PLATFORM_DOMAIN>`.

Mit echter Infrastruktur (Postgres + Redis, mehrere Instanzen):
```bash
docker compose -f infra/docker-compose.yml up --build --scale api=2 --scale worker=3
```

Tests (ohne `TEST_DATABASE_URL` nur In-Memory, mit zusätzlich PostgreSQL inkl. RLS-Prüfung):
```bash
npm run typecheck
TEST_DATABASE_URL=postgres://companygpt:companygpt@localhost:5432/companygpt_test npm test
```

## Demo-Zugänge
Passwort für alle: `demo1234`

| Zugang | E-Mail |
|---|---|
| CompanyGPT-Steuerzentrale | `du@companygpt.demo` |
| Admin · GantnerGPT | `admin@gantner-instruments.com` |
| Mitarbeiter · GantnerGPT | `user001@gantner-instruments.com` |

## API im Überblick
| Bereich | Endpunkte |
|---|---|
| Öffentlich (pro Kunde) | `GET /v1/tenant` (Branding + CSS-Theme), `POST /v1/auth/login`, `GET/POST /v1/invites/token/:token[/accept]` |
| Chat | `POST /v1/chat` – Vektorsuche nur in erlaubten Sammlungen, Antwort mit Quellen |
| Wissen (Admin) | `GET/POST /v1/sources`, `PATCH/DELETE /v1/sources/:id`, `POST /v1/sources/bulk-delete`, `POST /v1/sources/:id/restore`, `GET/POST /v1/release` |
| Apps (Admin) | `GET /v1/apps`, `GET/POST /v1/connections`, `PATCH/DELETE /v1/connections/:id` (mit Sicherheitsbewertung) |
| Team (Admin) | `GET /v1/members`, `PATCH/DELETE /v1/members/:id`, `GET/POST /v1/invites`, `POST /v1/invites/:id/resend\|revoke` |
| Support | `GET/POST /v1/tickets`, `GET /v1/tickets/:id`, `POST /v1/tickets/:id/messages\|reopen` |
| Steuerzentrale | `POST /platform/auth/login`, `GET /platform/overview`, `GET/POST/PATCH /platform/tenants`, `GET/POST /platform/templates`, `POST /platform/rollouts`, `GET/PATCH /platform/tickets[/:id]`, `POST /platform/tickets/:id/messages`, `GET /platform/activity` |

## Zwei Oberflächen (Prototyp)

### Kunden-Dashboard
Chat · Wissen hinzufügen · Wissen verwalten · Apps (Business Central, Outlook, SharePoint, OneDrive, Google Drive, Dropbox, Teams, Confluence, Netzlaufwerk, Websuche) · Team & Einladungen · Zugriff & Rechte · GPT-Verhalten · Hilfe & Support · „Wissen freigeben“

### CompanyGPT-Steuerzentrale
Übersicht · Kunden-Dashboards (anlegen, Branding, als Admin öffnen) · Updates (veröffentlichen, an alle oder gezielt ausrollen) · Support-Posteingang · Aktivität

**Synchronisiert von der Plattform:** Funktionen, App-Katalog, Sicherheitsvorgaben, Standard-Richtlinien. **Bleibt beim Kunden:** Wissen, Benutzer, Chats, GPT-Anweisungen, Branding.

## Weiterlesen
- [`docs/SKALIERUNG.md`](docs/SKALIERUNG.md) – wie das System von 1 auf tausende Kunden wächst
- [`docs/ARCHITEKTUR.md`](docs/ARCHITEKTUR.md) – Datenmodell, Rollen, Abläufe, Sicherheit
- [`CHANGELOG.md`](CHANGELOG.md) – alle Stände
