import type { AppDefinition } from './catalog';
import type { Connection } from './types';

export interface SecurityScore {
  score: number;
  level: 'high' | 'medium' | 'low';
  recommendations: string[];
}

/** Sicherheitsbewertung einer App-Verbindung (0–100), identisch zur Anzeige im Dashboard. */
export function securityScore(conn: Pick<Connection, 'permission' | 'actions' | 'security' | 'auth'>, app: AppDefinition): SecurityScore {
  let n = 30;
  const recs: string[] = [];
  if (conn.permission === 'read') n += 30;
  else {
    if (conn.security.confirmActions) n += 15;
    else recs.push('Aktionen nur nach Bestätigung ausführen');
    const risky = app.actions.filter((a) => a.risky && conn.actions.includes(a.key));
    if (risky.length) {
      n -= 10 * risky.length;
      recs.push(`„${risky.map((a) => a.label).join('“, „')}“ deaktivieren – hohes Risiko`);
    }
    recs.push('Wenn möglich auf „Nur lesen“ beschränken');
  }
  if (conn.security.inheritPermissions) n += 15; else recs.push('Berechtigungen der Quelle übernehmen');
  if (conn.security.audit) n += 10; else recs.push('Zugriffe im Audit-Log protokollieren');
  if (conn.security.rotateCredentials) n += 5; else recs.push('Zugangsdaten automatisch rotieren');
  if (conn.security.excludeConfidential) n += 5; else recs.push('Vertrauliche Inhalte ausschließen');
  if (!app.requiresAuth || conn.auth === 'delegated') n += 5; else recs.push('Delegierte Anmeldung statt Dienstkonto verwenden');
  const score = Math.max(0, Math.min(100, n));
  return { score, level: score >= 80 ? 'high' : score >= 55 ? 'medium' : 'low', recommendations: recs };
}
