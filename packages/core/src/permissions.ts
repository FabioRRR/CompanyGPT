import type { Collection, Role } from './types';

export const isAdmin = (role: Role) => role === 'admin';

/**
 * Sammlungen, die eine Person über das GPT abfragen darf.
 * Admins: alle Sammlungen, die für das GPT freigegeben sind.
 * Mitarbeiter: zusätzlich nur solche mit Mitarbeiter-Zugriff.
 * `excluded` sind Sammlungen, die die Person im Chat abgewählt hat.
 */
export function allowedCollections(collections: Collection[], role: Role, excluded: string[] = []): Collection[] {
  return collections.filter(
    (c) => c.gptEnabled && (isAdmin(role) || c.memberAccess) && !excluded.includes(c.id)
  );
}

export function canQueryCollection(collection: Collection, role: Role): boolean {
  return collection.gptEnabled && (isAdmin(role) || collection.memberAccess);
}

/** Es muss immer mindestens ein Admin übrig bleiben. */
export function canChangeRole(members: { id: string; role: Role }[], memberId: string, nextRole: Role): boolean {
  if (nextRole === 'admin') return true;
  const admins = members.filter((m) => m.role === 'admin');
  return !(admins.length === 1 && admins[0].id === memberId);
}
