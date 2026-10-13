import type { Source, SourceState } from './types';

/** Was beim Löschen passiert: Nie freigegebenes Wissen verschwindet sofort, freigegebenes wird zum Entfernen markiert. */
export function deleteAction(source: Pick<Source, 'state'>): 'remove' | 'mark' | 'none' {
  if (source.state === 'deleted') return 'none';
  return source.state === 'new' ? 'remove' : 'mark';
}

/** Zustand nach einer Änderung (Titel, Sammlung, Inhalt). */
export function stateAfterEdit(state: SourceState): SourceState {
  return state === 'live' ? 'changed' : state;
}

export function stateAfterRestore(source: Pick<Source, 'state' | 'prevState'>): SourceState {
  return source.state === 'deleted' ? source.prevState ?? 'live' : source.state;
}

export interface ReleasePlan {
  publish: string[];
  purge: string[];
  waiting: string[];
}

/**
 * Plan für „Wissen freigeben“: neue/geänderte und fertig indexierte Quellen gehen live,
 * markierte werden endgültig entfernt. Noch nicht indexierte Quellen warten.
 */
export function planRelease(sources: Pick<Source, 'id' | 'state' | 'indexStatus'>[]): ReleasePlan {
  const plan: ReleasePlan = { publish: [], purge: [], waiting: [] };
  for (const s of sources) {
    if (s.state === 'deleted') plan.purge.push(s.id);
    else if (s.state === 'new' || s.state === 'changed') {
      if (s.indexStatus === 'indexed') plan.publish.push(s.id);
      else plan.waiting.push(s.id);
    }
  }
  return plan;
}

/** Text in überlappende Abschnitte für die Vektorsuche zerlegen. */
export function chunkText(text: string, size = 900, overlap = 150): string[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      const breakAt = Math.max(clean.lastIndexOf('\n', end), clean.lastIndexOf('. ', end));
      if (breakAt > start + size * 0.5) end = breakAt + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks.filter(Boolean);
}
