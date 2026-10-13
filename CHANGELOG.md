# Changelog

Alle Stände, neueste zuerst.

## 0.10.0 – 13.10.2026 · Skalierbare Grundlage
- **Backend als Monorepo:** `apps/api` (zustandslose Fastify-API), `apps/worker` (Hintergrund-Jobs), `packages/core` (Geschäftslogik), `packages/server` (Speicher, Warteschlange, KI-Anbieter)
- **Mandantenfähige Datenbank:** PostgreSQL mit `tenant_id` überall und Row-Level Security (FORCE) – Kundendaten sind auf Datenbankebene getrennt
- **Vektorsuche** mit pgvector, nach Kunde hash-partitioniert (16 Partitionen), HNSW-Index; Entwurf/live-Trennung für „Wissen freigeben“
- **Warteschlange** mit Redis/BullMQ: Indexierung, App-Sync, Einladungs-Mails, Rollouts in Wellen – Worker beliebig skalierbar
- **Rate-Limit pro Kunde und Person**, Health-/Ready-Checks, sauberes Herunterfahren
- Austauschbare Anbieter für Sprachmodell (Claude), Embeddings und E-Mail; Demo-Anbieter ohne externe Dienste
- Alle Abläufe aus dem Prototyp als API: Login, Einladungen, Wissen, Freigabe, Chat, Apps, Team, Support, Steuerzentrale, Vorlagen & Rollouts
- **15 automatische Tests**, u. a. kompletter Ablauf gegen PostgreSQL und Prüfung der Mandantentrennung; CI-Workflow für GitHub Actions
- Dockerfile und docker-compose für eine skalierbare Gesamtumgebung, `docs/SKALIERUNG.md` mit Wachstumsstufen

## 0.9.0 – 13.10.2026 · Steuerzentrale & Support
- Plattform heißt jetzt **CompanyGPT**, Gantner ist ein Kunde darauf
- Neue Startseite der Konsole: **Steuerzentrale** mit Kennzahlen, offenen Punkten, Kundenübersicht und Aktivität
- **Support-Tool**: Benutzer stellen Anfragen unter „Hilfe & Support“ (Art, Betreff, Beschreibung, Dringlichkeit, Screenshot, Chat-Kontext); Posteingang in der Steuerzentrale mit Status, Priorität, Textbausteinen und Antworten zurück ins Dashboard
- **Gezielte Updates**: Kunden auswählen und nur an diese ausrollen; nach dem Update sehen Benutzer einen Hinweis „Neu in vX“

## 0.8.0 – 13.10.2026 · Login, Einladungen, White-Label, Plattform-Konsole
- Standard-Login (E-Mail/Passwort, „Angemeldet bleiben“, Passwort vergessen, Microsoft-Anmeldung), eigene Login-Seite pro Kunde
- Seite „Team & Einladungen“, Einladungen per (simulierter) E-Mail, Konto über Einladungslink anlegen
- Komplettes White-Labeling: Logo, GPT-Name, Primärfarbe, Adresse pro Kunde
- Plattform-Konsole: Kunden-Dashboards anlegen, Branding bearbeiten, Vorlagen-Versionen veröffentlichen und synchronisieren

## 0.7.0 · Wissen verwalten
- Getrennte Seiten „Wissen hinzufügen“ und „Wissen verwalten“ mit Filtern, Mehrfachauswahl, Verschieben und Löschen mit Bestätigung

## 0.6.0 · Typografie
- Durchgehend Inter (Fallback Segoe UI)

## 0.5.0 · Apps
- App-Katalog mit Kategorien und Suche: Business Central, Outlook, SharePoint, OneDrive, Google Drive, Dropbox, Teams, Confluence, Netzlaufwerk, Websuche
- Je App eigene Bereiche und Aktionen; Live-Daten aus Business Central im Chat

## 0.4.0 · Schnittstellen & Freigabe
- Anbindungen mit *Nur lesen* / *Lesen & Schreiben*, Sicherheitsbewertung
- Manuelle Wissenseinträge, Button „Wissen freigeben“

## 0.3.0 · Beispiel-Antwort
- Brückenmonitoring mit 24 DMS-Messstellen: Messkette, Modulvergleich A116/A146, Quellen von gantner-instruments.com

## 0.2.0 · Logo & CI
- Logo „Gantner instruments GPT“ im Stil des Konfigurators, Logo-Blau #0040C4

## 0.1.0 · Erster UX-Entwurf
- Chat im Stil von ChatGPT/Claude, Wissensbasis, Zugriffsrechte, GPT-Verhalten, Benutzerwechsel ADMIN/USER001
