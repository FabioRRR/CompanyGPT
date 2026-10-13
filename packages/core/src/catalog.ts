export type AppCategory = 'erp' | 'mail' | 'files' | 'collab' | 'web';

export interface AppAction {
  key: string;
  label: string;
  risky: boolean;
}

export interface AppDefinition {
  key: string;
  name: string;
  category: AppCategory;
  description: string;
  requiresAuth: boolean;
  supportsWrite: boolean;
  areaLabel: string;
  areas: { key: string; label: string }[];
  actions: AppAction[];
}

const fileActions: AppAction[] = [
  { key: 'create', label: 'Dokumente anlegen', risky: false },
  { key: 'edit', label: 'Dokumente ändern', risky: false },
  { key: 'delete', label: 'Dokumente löschen', risky: true }
];

const files = (key: string, name: string, description: string, areas: [string, string][], areaLabel = 'Ordner & Ablagen'): AppDefinition => ({
  key, name, category: 'files', description, requiresAuth: true, supportsWrite: true, areaLabel,
  areas: areas.map(([k, label]) => ({ key: k, label })), actions: fileActions
});

/**
 * App-Katalog der Vorlage. Neue Apps kommen hier hinzu und werden mit einer
 * neuen Vorlagen-Version an alle Kunden ausgerollt.
 */
export const APP_CATALOG: AppDefinition[] = [
  {
    key: 'business-central', name: 'Microsoft Business Central', category: 'erp', requiresAuth: true, supportsWrite: true,
    description: 'ERP-System: Artikel, Lagerbestand, Kunden, Aufträge und Preise', areaLabel: 'Datenbereiche',
    areas: [
      { key: 'items', label: 'Artikel & Stücklisten' }, { key: 'inventory', label: 'Lagerbestand' },
      { key: 'customers', label: 'Kunden & Kontakte' }, { key: 'orders', label: 'Verkaufsaufträge' },
      { key: 'quotes', label: 'Angebote' }, { key: 'prices', label: 'Preislisten' }
    ],
    actions: [
      { key: 'quote-draft', label: 'Angebote als Entwurf anlegen', risky: false },
      { key: 'contacts', label: 'Kontakte anlegen und ändern', risky: false },
      { key: 'post', label: 'Belege buchen', risky: true }
    ]
  },
  {
    key: 'outlook', name: 'Outlook', category: 'mail', requiresAuth: true, supportsWrite: true,
    description: 'E-Mails, Kalender und Kontakte aus Microsoft 365', areaLabel: 'Postfächer & Kalender',
    areas: [
      { key: 'own', label: 'Eigenes Postfach' }, { key: 'shared-sales', label: 'Gruppenpostfach Vertrieb' },
      { key: 'shared-support', label: 'Gruppenpostfach Support' }, { key: 'calendar', label: 'Kalender' }
    ],
    actions: [
      { key: 'draft', label: 'E-Mail-Entwürfe erstellen', risky: false },
      { key: 'event', label: 'Termine anlegen', risky: false },
      { key: 'send', label: 'E-Mails direkt senden', risky: true }
    ]
  },
  files('sharepoint', 'SharePoint', 'Websites, Dokumentbibliotheken und Listen', [['wiki', 'Technik-Wiki'], ['sales', 'Vertrieb – Angebote'], ['hr', 'HR-Portal'], ['qm', 'Qualitätsmanagement']], 'Websites & Bibliotheken'),
  files('onedrive', 'OneDrive', 'Persönliche und geteilte Ordner aus Microsoft 365', [['products', 'Produktdaten'], ['service', 'Servicefälle'], ['slides', 'Präsentationen']]),
  files('google-drive', 'Google Drive', 'Geteilte Ablagen (Shared Drives) und Ordner', [['marketing', 'Marketing'], ['events', 'Messen & Events'], ['partners', 'Partnerunterlagen']]),
  files('dropbox', 'Dropbox', 'Team-Ordner und geteilte Kundenprojekte', [['team', 'Team-Ordner'], ['projects', 'Kundenprojekte'], ['media', 'Bilder & Medien']]),
  files('network-drive', 'Netzlaufwerk', 'Freigegebene Ordner im Firmennetz', [['projects', 'Projekte'], ['templates', 'Vorlagen']]),
  {
    key: 'teams', name: 'Microsoft Teams', category: 'collab', requiresAuth: true, supportsWrite: true,
    description: 'Kanäle, Beiträge und Dateien', areaLabel: 'Teams & Kanäle',
    areas: [{ key: 'engineering', label: 'Engineering' }, { key: 'support', label: 'Support' }, { key: 'general', label: 'Allgemein' }],
    actions: [
      { key: 'post', label: 'Beiträge verfassen', risky: false },
      { key: 'reply', label: 'Auf Nachrichten antworten', risky: false },
      { key: 'delete', label: 'Nachrichten löschen', risky: true }
    ]
  },
  {
    key: 'confluence', name: 'Confluence', category: 'collab', requiresAuth: true, supportsWrite: true,
    description: 'Wiki-Bereiche und Seiten', areaLabel: 'Bereiche',
    areas: [{ key: 'dev', label: 'Entwicklung' }, { key: 'docs', label: 'Produktdokumentation' }],
    actions: [
      { key: 'create', label: 'Seiten anlegen', risky: false },
      { key: 'edit', label: 'Seiten ändern', risky: false },
      { key: 'delete', label: 'Seiten löschen', risky: true }
    ]
  },
  {
    key: 'web-search', name: 'Websuche', category: 'web', requiresAuth: false, supportsWrite: false,
    description: 'Öffentliches Internet für allgemeine Fragen', areaLabel: 'Umfang', areas: [], actions: []
  }
];

export function findApp(key: string): AppDefinition | undefined {
  return APP_CATALOG.find((a) => a.key === key);
}

/** Prüft, ob Bereiche und Aktionen zur App passen. Gibt Fehlermeldungen zurück. */
export function validateConnection(app: AppDefinition, input: { areas: string[]; permission: 'read' | 'write'; actions: string[] }): string[] {
  const errors: string[] = [];
  const areaKeys = app.areas.map((a) => a.key);
  if (app.areas.length && !input.areas.length) errors.push('Mindestens ein Bereich muss ausgewählt sein.');
  for (const a of input.areas) if (!areaKeys.includes(a)) errors.push(`Unbekannter Bereich: ${a}`);
  if (input.permission === 'write' && !app.supportsWrite) errors.push(`${app.name} unterstützt keine Schreibrechte.`);
  const actionKeys = app.actions.map((a) => a.key);
  for (const a of input.actions) if (!actionKeys.includes(a)) errors.push(`Unbekannte Aktion: ${a}`);
  if (input.permission === 'read' && input.actions.length) errors.push('Bei „Nur lesen“ sind keine Aktionen erlaubt.');
  return errors;
}
