export const isEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());

export function parseEmails(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const e = raw.trim().toLowerCase();
    if (e && !seen.has(e)) { seen.add(e); out.push(e); }
  }
  return out;
}

/** Subdomain aus dem Firmennamen: „Gantner Instruments GmbH“ → „gantner-instruments“ */
export function slugify(text: string): string {
  return text.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\b(gmbh|ag|kg|se|co|inc|ltd)\b/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

export const isSlug = (s: string) => /^[a-z0-9-]{2,30}$/.test(s);

export const INVITE_DAYS = 7;

export function inviteExpiry(from: Date, days = INVITE_DAYS): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
