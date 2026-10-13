export * from './types';
export * from './permissions';
export * from './knowledge';
export * from './catalog';
export * from './security';
export * from './template';
export * from './theme';
export * from './text';

export const DEFAULT_COLLECTIONS: { key: string; name: string; memberAccess: boolean }[] = [
  { key: 'hr', name: 'HR & Personal', memberAccess: true },
  { key: 'tech', name: 'Technik & Produkte', memberAccess: true },
  { key: 'sales', name: 'Vertrieb & Preise', memberAccess: true },
  { key: 'it', name: 'IT & Sicherheit', memberAccess: true },
  { key: 'mgmt', name: 'Geschäftsführung', memberAccess: false }
];
