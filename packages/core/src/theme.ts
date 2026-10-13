/** White-Label: alle Markenfarben eines Kunden-Dashboards werden aus einer Primärfarbe abgeleitet. */
export const isHexColor = (h: string) => /^#[0-9a-fA-F]{6}$/.test(h);

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export function mix(a: string, b: string, t: number): string {
  const A = rgb(a), B = rgb(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function contrastOnWhiteText(hex: string): number {
  const lum = rgb(hex).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 1.05 / (0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2] + 0.05);
}

export interface Palette {
  primary: string; primaryDark: string; soft: string; line: string; tint: string; active: string; sidebar: string; hover: string;
}

export function palette(primary: string): Palette {
  const p = isHexColor(primary) ? primary.toUpperCase() : '#0040C4';
  return {
    primary: p,
    primaryDark: mix(p, '#000000', 0.25),
    soft: mix(p, '#FFFFFF', 0.9),
    line: mix(p, '#FFFFFF', 0.72),
    tint: mix(p, '#FFFFFF', 0.955),
    active: mix(p, '#FFFFFF', 0.87),
    sidebar: mix(p, '#FFFFFF', 0.965),
    hover: mix(p, '#FFFFFF', 0.92)
  };
}

/** CSS-Variablen für das Frontend. */
export function themeCss(primary: string): string {
  const t = palette(primary);
  return `:root{--p:${t.primary};--pd:${t.primaryDark};--ps:${t.soft};--pl:${t.line};--pt:${t.tint};--pa:${t.active};--side:${t.sidebar};--sh:${t.hover}}`;
}
