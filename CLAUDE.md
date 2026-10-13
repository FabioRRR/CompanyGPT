# Arbeitsregeln für dieses Repository

- Dieses Repo enthält immer den **neuesten Stand** von CompanyGPT. Nach jeder Änderung am Prototyp:
  1. `prototype/CompanyGPT.dc.html` und `prototype/canvas.json` mit dem aktuellen Stand des Artifacts „GantnerGPT UX“ ersetzen.
  2. Neuen Eintrag oben in `CHANGELOG.md` ergänzen (Version hochzählen, kurz auf Deutsch).
  3. README/Architektur anpassen, wenn sich Bereiche oder Abläufe ändern.
  4. Commit auf `main` mit aussagekräftiger Nachricht und pushen.
- Sprache in Oberfläche und Doku: Deutsch.
- „Company“ ist der Platzhalter für die jeweilige Kundenfirma; Gantner Instruments ist Beispielkunde.
- Backend-Regeln:
  - Geschäftslogik gehört nach `packages/core` (ohne Abhängigkeiten, mit Tests), nicht in Routen.
  - Jede neue Kunden-Tabelle braucht `tenant_id`, Row-Level Security (siehe `db/migrations/001_init.sql`) und einen Test.
  - Schemaänderungen nur als neue Datei in `db/migrations/` (nie alte Migrationen ändern).
  - Vor jedem Commit: `npm run typecheck` und `npm test` (mit `TEST_DATABASE_URL`, falls PostgreSQL verfügbar) müssen grün sein.
