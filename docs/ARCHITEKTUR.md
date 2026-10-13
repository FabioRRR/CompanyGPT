# CompanyGPT – Architektur-Konzept

Abgeleitet aus dem Prototyp und umgesetzt im Backend (`apps/`, `packages/`, `db/`). Skalierung: siehe [`SKALIERUNG.md`](SKALIERUNG.md).

## Technik
| Schicht | Wahl |
|---|---|
| Sprache | TypeScript (Node 22), npm-Workspaces |
| API | Fastify, Zod-Validierung, JWT (jose) |
| Datenbank | PostgreSQL 16 + pgvector, Row-Level Security |
| Warteschlange | Redis + BullMQ |
| KI | Claude über die Anthropic API, Embeddings über OpenAI-kompatiblen Endpunkt (1024 Dimensionen) |
| Tests | Vitest – In-Memory und echte Datenbank |

## Mandanten-Modell
- **Plattform** (CompanyGPT): ein Betreiber-Team, eine Steuerzentrale.
- **Mandant / Kunde** (z. B. Gantner Instruments): eigenes Dashboard unter `firma.[domain]` oder eigener Domain, eigenes Branding, strikt getrennte Daten.
- **Vorlage (Template)**: versionierte Definition von Funktionen, App-Katalog, Sicherheitsvorgaben und Standard-Richtlinien. Jeder Mandant steht auf einer Version; Updates werden gesammelt oder gezielt ausgerollt.

## Datenmodell (vereinfacht)
| Objekt | Felder | Gehört zu |
|---|---|---|
| Tenant | id, company, subdomain, status, templateVersion, brand {primary, logo, signet} | Plattform |
| Member | id, name, email, role (admin/member), authProvider, lastActive | Tenant |
| Invite | id, email, role, token, sentAt, status (pending/accepted/revoked), invitedBy | Tenant |
| Collection | id, name, gptEnabled, memberAccess | Tenant |
| Source | id, kind (file/web/note/app), collection, state (live/new/changed/deleted), indexStatus | Tenant |
| Connection | id, app, auth (delegated/service), areas[], permission (read/write), actions[], security {inherit, audit, rotate, excludeConfidential}, sync | Tenant |
| Chat / Message | memberId, messages, sources[] | Tenant |
| Ticket | id, tenantId, memberId, kind, subject, priority, status, context, attachments, messages[] | Plattform (mandantenübergreifend lesbar nur für Support) |
| TemplateVersion | version, date, notes[] | Plattform |

## Rollen
- **Plattform-Team**: Steuerzentrale, Mandanten anlegen, Branding, Updates, Support. Zugriff auf Mandanten-Dashboards nur explizit („als Admin öffnen“) und protokolliert.
- **Admin (Kunde)**: Wissen, Apps, Team, Rechte, GPT-Verhalten, Freigabe.
- **Mitarbeiter (Kunde)**: Chat und Support, nur freigegebene Sammlungen.

## Kernabläufe
1. **Kunde anlegen** → Tenant mit Template-Version → Einladung an ersten Admin.
2. **Einladung** → Mail mit Token-Link (7 Tage gültig) → Konto anlegen (Passwort oder Microsoft) → Member.
3. **Wissen** → Upload/Web/Notiz/App → Indexierung → Status „neu“ → **Wissen freigeben** → live im GPT.
4. **Löschen** → Status „wird entfernt“ (wiederherstellbar) → mit Freigabe endgültig aus Index entfernt.
5. **Update** → neue Template-Version → Rollout an alle oder Auswahl → Hinweis „Neu in vX“ für Benutzer.
6. **Support** → Ticket aus dem Dashboard → Posteingang Steuerzentrale → Antwort im Dashboard + E-Mail.

## Sicherheitsgrundsätze für App-Verbindungen
- *Nur lesen* als Standard, Schreibaktionen einzeln freischalten, riskante Aktionen (Löschen, Buchen, Senden) markiert.
- Delegierte Anmeldung (OAuth/Entra ID): Benutzer sehen über das GPT nur, was sie auch im Quellsystem sehen dürfen.
- Schreibaktionen nur nach Bestätigung durch die Person.
- Audit-Log, Zugangsdaten im Schlüsseltresor mit Rotation, Ausschluss vertraulich gelabelter Dokumente.

## Offene Entscheidungen
- Hosting & Datenresidenz (EU/CH), Embedding-Anbieter
- Eigene Domains pro Kunde (TLS-Zertifikate)
- Abrechnung pro Mandant / pro Benutzer
