# CompanyGPT

White-Label-Wissensassistent für Unternehmen. Jede Firma bekommt ein eigenes, gebrandetes Dashboard („Company“ steht als Platzhalter für die jeweilige Firma – z. B. **GantnerGPT** für Gantner Instruments). Über die **CompanyGPT-Steuerzentrale** werden alle Kunden-Dashboards angelegt, aktualisiert und betreut.

> **Status:** klickbarer UX-Prototyp. Antworten des Sprachmodells, E-Mail-Versand, Login und App-Anbindungen sind simuliert.

## Zwei Oberflächen

### 1. Kunden-Dashboard (pro Firma)
| Bereich | Wer | Inhalt |
|---|---|---|
| Chat | alle | Fragen stellen, Antworten mit Quellen, Suche nur in freigegebenen Sammlungen |
| Wissen hinzufügen | Admin | Upload, Webseiten, manuelle Wissenseinträge |
| Wissen verwalten | Admin | Filtern, Mehrfachauswahl, Ändern, Löschen (mit Bestätigung, bis zur Freigabe wiederherstellbar) |
| Apps | Admin | Business Central, Outlook, SharePoint, OneDrive, Google Drive, Dropbox, Teams, Confluence, Netzlaufwerk, Websuche – je App: Bereiche, *Nur lesen* / *Lesen & Aktionen*, Sicherheitsbewertung |
| Team & Einladungen | Admin | Mitarbeiter per E-Mail einladen, Rollen, Einladungen erneut senden/widerrufen |
| Zugriff & Rechte | Admin | Welche Sammlungen das GPT nutzt, was Mitarbeiter abfragen dürfen |
| GPT-Verhalten | Admin | Name, Anweisungen, Antwortstil, Gesprächsstarter, Richtlinien |
| Hilfe & Support | alle | Anfragen an den CompanyGPT-Support stellen, Antworten direkt im Dashboard |
| „Wissen freigeben“ | Admin | Unten rechts: alle Änderungen gesammelt veröffentlichen |

### 2. CompanyGPT-Steuerzentrale (Plattform-Team)
| Bereich | Inhalt |
|---|---|
| Steuerzentrale | Kennzahlen, „Braucht deine Aufmerksamkeit“, Kunden im Überblick, letzte Aktivität |
| Kunden-Dashboards | Neues Dashboard anlegen (Firma, Adresse, GPT-Name, Logo, Primärfarbe, erster Admin), Branding bearbeiten, als Admin öffnen |
| Updates | Neue Vorlagen-Version veröffentlichen, an alle oder gezielt an ausgewählte Kunden ausrollen; Kunden sehen danach einen Hinweis mit den Neuerungen |
| Support | Posteingang aller Kunden-Anfragen, Status & Priorität, Textbausteine, Antworten landen beim Benutzer im Dashboard |
| Aktivität | Protokoll über alle Dashboards |

**Synchronisiert von der Plattform:** Funktionen & Oberfläche, App-Katalog, Sicherheitsvorgaben, Standard-Richtlinien.
**Bleibt beim Kunden:** Wissen, Benutzer & Einladungen, Chats, GPT-Anweisungen, Branding.

## Demo-Zugänge (Prototyp)
Passwort für alle: `demo1234`

| Zugang | E-Mail |
|---|---|
| CompanyGPT-Steuerzentrale | `du@companygpt.demo` |
| Admin · GantnerGPT | `admin@gantner-instruments.com` |
| Mitarbeiter · GantnerGPT | `user001@gantner-instruments.com` |

## Projektstruktur
```
prototype/
  CompanyGPT.dc.html   Quelltext des klickbaren Prototyps (Design-Component-Format)
  canvas.json          Canvas-Index des Prototyps
assets/kunden/gantner/ Logo & Signet des Beispielkunden Gantner
docs/
  ARCHITEKTUR.md       Datenmodell, Rollen, Abläufe, Sicherheitskonzept
CHANGELOG.md           Entwicklungsstand Schritt für Schritt
CLAUDE.md              Arbeitsregeln für die Weiterentwicklung mit Claude
```

## Prototyp ansehen
Der Prototyp läuft im Claude-Design-Canvas (Artifact „GantnerGPT UX“). `CompanyGPT.dc.html` ist der vollständige Quelltext; Logos sind dort als hochgeladene Assets (`/_blob/…`) eingebunden und liegen zusätzlich unter `assets/`.

Über die Tweaks kann der Startbildschirm gewählt werden: `login`, `tenant-admin`, `tenant-user`, `invite`, `console`.

## Nächste Schritte Richtung Produkt
1. Technische Architektur festlegen (siehe `docs/ARCHITEKTUR.md`)
2. Anmeldung über Microsoft Entra ID / OIDC, Einladungs-Mails über einen Mail-Dienst
3. Mandantentrennung der Daten, Vektor-Index pro Kunde
4. Erste echte App-Anbindungen (SharePoint/OneDrive via Microsoft Graph, Business Central API)
