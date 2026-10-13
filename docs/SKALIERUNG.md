# CompanyGPT – Skalierung

Wie CompanyGPT von einem Kunden auf viele tausend Kunden wächst, ohne die Architektur neu bauen zu müssen.

## Grundprinzipien (umgesetzt)

| Prinzip | Umsetzung im Code | Warum es skaliert |
|---|---|---|
| **Zustandslose API** | `apps/api` – Sitzung steckt im JWT, keine Daten im Prozess | Beliebig viele API-Instanzen hinter einem Load Balancer |
| **Arbeit in Warteschlangen** | `apps/worker` + BullMQ/Redis (`packages/server/src/bull.ts`) | Indexierung, App-Sync, E-Mails und Rollouts blockieren keine Anfragen; Worker separat skalierbar |
| **Ein Schema, viele Kunden** | Jede Kundentabelle hat `tenant_id` (`db/migrations/001_init.sql`) | Ein neuer Kunde ist eine Zeile, keine neue Datenbank – Anlage in Sekunden |
| **Isolation in der Datenbank** | Row-Level Security mit `FORCE`, Kontext pro Transaktion (`app.tenant_id`) | Selbst ein vergessener Filter gibt keine fremden Daten preis – automatisch getestet |
| **Partitionierte Vektorsuche** | `chunks` 16-fach nach `tenant_id` hash-partitioniert, HNSW-Index | Suche bleibt pro Kunde klein und schnell; Partitionen lassen sich später auf eigene Server verteilen |
| **Entwurf vs. live** | Abschnitte mit `live`-Flag, Freigabe tauscht atomar (`applyRelease`) | Neuindexierung stört laufende Antworten nicht |
| **Rollout in Wellen** | `planRollout` (Batches à 25) im Job `rollout` | Fehlerhafte Updates treffen nie alle Kunden gleichzeitig; gezielte Rollouts möglich |
| **Fair Use pro Kunde** | Rate-Limit pro Kunde + Person, mit Redis über alle Instanzen | Ein lauter Kunde bremst die anderen nicht aus |
| **Austauschbare Anbieter** | `Embedder`, `Llm`, `Mailer`, `Store`, `JobQueue` als Schnittstellen | Modell- oder Anbieterwechsel ohne Umbau; Tests laufen ohne externe Dienste |
| **Eine Geschäftslogik** | `packages/core` – Rechte, Freigabe, Sicherheitsbewertung, Versionen, Theme | Frontend, API und Worker rechnen identisch; Logik ist getestet |
| **Sauberes Herunterfahren** | SIGTERM-Handler in API und Worker | Rolling Deployments und Autoscaling ohne abgebrochene Anfragen |
| **Health-Checks** | `/health` (lebt), `/ready` (DB erreichbar) | Orchestrierung (Kubernetes, ECS) erkennt kranke Instanzen |

## Wachstumsstufen

### Stufe 1 · bis ca. 50 Kunden / 5.000 Benutzer
- 2 API-Instanzen, 2 Worker, 1 PostgreSQL (verwaltet, z. B. Azure Database for PostgreSQL / AWS RDS) mit täglichem Backup, 1 Redis
- Alles aus diesem Repo, `infra/docker-compose.yml` als Vorlage
- Kosten treibt vor allem das Sprachmodell – Verbrauch pro Kunde messen

### Stufe 2 · bis ca. 500 Kunden / 50.000 Benutzer
- API und Worker mit **Autoscaling** (CPU bzw. Warteschlangenlänge)
- **Lese-Replikate** für Postgres; Suche und Listen auf Replikate
- **PgBouncer** vor Postgres (Transaktions-Pooling passt, weil der RLS-Kontext per `set_config(..., true)` nur pro Transaktion gilt)
- Datei-Uploads direkt in **Objektspeicher (S3/Azure Blob)** über signierte URLs, API nur noch Metadaten
- **Caching** des Brandings und der Sammlungen pro Kunde in Redis
- Antworten des Sprachmodells **streamen**

### Stufe 3 · mehrere tausend Kunden
- **Zellen-Architektur:** mehrere identische Stacks („Zellen“), jeder Kunde gehört genau einer Zelle; eine kleine Routing-Tabelle (`slug → Zelle`) in der Steuerzentrale
- Große Kunden bekommen eine **eigene Zelle oder Datenbank** („Enterprise-Isolation“) – gleicher Code, andere `DATABASE_URL`
- Vektorsuche bei Bedarf in einen eigenen Dienst auslagern (die `Store.searchChunks`-Schnittstelle bleibt)
- **Regionen** (EU/CH) für Datenresidenz – Zellen pro Region

## Betrieb

- **Nie als Superuser verbinden:** Superuser umgehen Row-Level Security. Die App nutzt eine eigene Rolle (`infra/postgres-init.sql`).
- **Migrationen** laufen vor dem Deployment als eigener Schritt (`npm run migrate`), mit Advisory-Lock gegen parallele Ausführung.
- **Jobs** werden bei Fehlern 5× mit exponentiellem Backoff wiederholt; fehlgeschlagene bleiben zur Analyse erhalten.
- **Beobachtbarkeit:** strukturierte Logs (pino) → zentrales Logging; Kennzahlen pro Kunde: Anfragen, Tokens, Indexierungsdauer, Warteschlangenlänge.
- **Geheimnisse** (JWT, API-Schlüssel, App-Zugangsdaten) gehören in einen Schlüsseltresor (Azure Key Vault / AWS Secrets Manager).

## Bewusst noch offen
- Echte App-Connectoren (Microsoft Graph, Business Central API) – der Job `sync-connection` ist vorbereitet
- Anmeldung über Microsoft Entra ID (OIDC) – Token-Schicht ist vorbereitet (`apps/api/src/http.ts`)
- Frontend als eigene App auf Basis des Prototyps (`prototype/`), nutzt `themeCss` aus `packages/core`
- Abrechnung und Kontingente pro Kunde
