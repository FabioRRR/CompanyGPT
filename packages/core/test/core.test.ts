import { describe, expect, it } from 'vitest';
import {
  allowedCollections, canChangeRole, chunkText, compareVersions, contrastOnWhiteText, deleteAction, findApp,
  nextVersion, palette, parseEmails, planRelease, planRollout, securityScore, slugify, stateAfterEdit, stateAfterRestore,
  validateConnection, type Collection
} from '../src';

const col = (id: string, gptEnabled: boolean, memberAccess: boolean): Collection =>
  ({ id, tenantId: 't', key: id, name: id, gptEnabled, memberAccess });

describe('Berechtigungen', () => {
  const cols = [col('hr', true, true), col('sales', true, false), col('mgmt', false, false)];
  it('Admins sehen alle GPT-Sammlungen, Mitarbeiter nur freigegebene', () => {
    expect(allowedCollections(cols, 'admin').map((c) => c.id)).toEqual(['hr', 'sales']);
    expect(allowedCollections(cols, 'member').map((c) => c.id)).toEqual(['hr']);
    expect(allowedCollections(cols, 'admin', ['hr']).map((c) => c.id)).toEqual(['sales']);
  });
  it('letzter Admin kann nicht herabgestuft werden', () => {
    const members = [{ id: 'a', role: 'admin' as const }, { id: 'b', role: 'member' as const }];
    expect(canChangeRole(members, 'a', 'member')).toBe(false);
    expect(canChangeRole(members, 'b', 'admin')).toBe(true);
  });
});

describe('Wissen & Freigabe', () => {
  it('Löschen: neu → sofort weg, freigegeben → markieren', () => {
    expect(deleteAction({ state: 'new' })).toBe('remove');
    expect(deleteAction({ state: 'live' })).toBe('mark');
    expect(deleteAction({ state: 'deleted' })).toBe('none');
    expect(stateAfterRestore({ state: 'deleted', prevState: 'changed' })).toBe('changed');
    expect(stateAfterEdit('live')).toBe('changed');
  });
  it('Freigabe veröffentlicht nur fertig indexierte Quellen', () => {
    const plan = planRelease([
      { id: '1', state: 'new', indexStatus: 'indexed' },
      { id: '2', state: 'new', indexStatus: 'indexing' },
      { id: '3', state: 'deleted', indexStatus: 'indexed' },
      { id: '4', state: 'live', indexStatus: 'indexed' }
    ]);
    expect(plan).toEqual({ publish: ['1'], purge: ['3'], waiting: ['2'] });
  });
  it('zerlegt lange Texte in überlappende Abschnitte', () => {
    const text = Array.from({ length: 60 }, (_, i) => `Satz Nummer ${i} über Messtechnik.`).join(' ');
    const chunks = chunkText(text, 300, 50);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 300)).toBe(true);
    expect(chunkText('   ')).toEqual([]);
  });
});

describe('Apps & Sicherheit', () => {
  const bc = findApp('business-central')!;
  it('prüft Bereiche und Aktionen', () => {
    expect(validateConnection(bc, { areas: [], permission: 'read', actions: [] })).toHaveLength(1);
    expect(validateConnection(bc, { areas: ['inventory'], permission: 'read', actions: ['post'] })).toContain('Bei „Nur lesen“ sind keine Aktionen erlaubt.');
    expect(validateConnection(bc, { areas: ['inventory'], permission: 'write', actions: ['quote-draft'] })).toEqual([]);
  });
  it('bewertet Nur-Lesen hoch und riskante Aktionen niedrig', () => {
    const base = { auth: 'delegated' as const, security: { inheritPermissions: true, audit: true, rotateCredentials: true, excludeConfidential: true, confirmActions: true } };
    expect(securityScore({ ...base, permission: 'read', actions: [] }, bc).level).toBe('high');
    const risky = securityScore({ ...base, permission: 'write', actions: ['post'], security: { ...base.security, confirmActions: false, audit: false } }, bc);
    expect(risky.score).toBeLessThan(80);
    expect(risky.recommendations.join(' ')).toContain('Belege buchen');
  });
});

describe('Vorlagen & Rollout', () => {
  it('vergleicht und erhöht Versionen', () => {
    expect(compareVersions('1.10', '1.9')).toBeGreaterThan(0);
    expect(nextVersion('1.4')).toBe('1.5');
    expect(nextVersion('1.4', 'major')).toBe('2.0');
  });
  it('rollt in Wellen und optional gezielt aus', () => {
    const tenants = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, templateVersion: i < 5 ? '1.5' : '1.4' }));
    const waves = planRollout(tenants, '1.5', { batchSize: 25 });
    expect(waves.map((w) => w.length)).toEqual([25, 25, 5]);
    expect(planRollout(tenants, '1.5', { only: ['t7', 't1'] }).flat().map((t) => t.id)).toEqual(['t7']);
  });
});

describe('White-Label & Texte', () => {
  it('leitet die Palette aus der Primärfarbe ab', () => {
    const p = palette('#0040C4');
    expect(p.primary).toBe('#0040C4');
    expect(p.soft).toMatch(/^#[0-9A-F]{6}$/);
    expect(contrastOnWhiteText('#0040C4')).toBeGreaterThan(4.5);
    expect(contrastOnWhiteText('#F5D547')).toBeLessThan(4.5);
  });
  it('erzeugt Subdomains und liest E-Mail-Listen', () => {
    expect(slugify('Gantner Instruments GmbH')).toBe('gantner-instruments');
    expect(parseEmails('a@x.com, B@x.com\na@x.com')).toEqual(['a@x.com', 'b@x.com']);
  });
});
