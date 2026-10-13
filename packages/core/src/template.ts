/** Vorlagen-Versionen im Format MAJOR.MINOR (z. B. 1.4). */
export function parseVersion(v: string): [number, number] {
  const m = /^(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) throw new Error(`Ungültige Version: ${v}`);
  return [Number(m[1]), Number(m[2])];
}

export function compareVersions(a: string, b: string): number {
  const [a1, a2] = parseVersion(a);
  const [b1, b2] = parseVersion(b);
  return a1 !== b1 ? a1 - b1 : a2 - b2;
}

export function nextVersion(v: string, kind: 'minor' | 'major' = 'minor'): string {
  const [major, minor] = parseVersion(v);
  return kind === 'major' ? `${major + 1}.0` : `${major}.${minor + 1}`;
}

/**
 * Rollout in Wellen: Kunden werden in Batches aktualisiert, damit ein fehlerhaftes
 * Update nie alle Mandanten gleichzeitig trifft. Optional nur ausgewählte Kunden.
 */
export function planRollout<T extends { id: string; templateVersion: string }>(
  tenants: T[], target: string, opts: { only?: string[]; batchSize?: number } = {}
): T[][] {
  const batchSize = Math.max(1, opts.batchSize ?? 25);
  const due = tenants.filter((t) => compareVersions(t.templateVersion, target) < 0 && (!opts.only || opts.only.includes(t.id)));
  const batches: T[][] = [];
  for (let i = 0; i < due.length; i += batchSize) batches.push(due.slice(i, i + batchSize));
  return batches;
}
