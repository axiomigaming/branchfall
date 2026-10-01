/** Integer hundredths of a credit. Never a float in a money path. */
export type Cents = number;

export function payout(stake: Cents, mult: number): Cents {
  // stake ≤ 1e5, mult ≤ 1e6 → product ≤ 1e11, well inside 2^53.
  return Math.floor((stake * mult) / 100);
}

export function formatCredits(c: Cents, opts: { sign?: boolean } = {}): string {
  const neg = c < 0;
  const abs = Math.abs(c);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = neg ? '−' : opts.sign ? '+' : '';
  return `${sign}${grouped}.${frac}`;
}

export function formatMult(mult: number): string {
  const whole = Math.floor(mult / 100);
  const frac = String(mult % 100).padStart(2, '0');
  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

/** Parse a user-typed credit amount ("12", "12.5", "1,200.00") into cents, or null. */
export function parseCredits(text: string): Cents | null {
  const t = text.replace(/[,\s]/g, '');
  if (!/^\d{1,9}(\.\d{0,2})?$/.test(t)) return null;
  const [w, f = ''] = t.split('.');
  return Number(w) * 100 + Number((f + '00').slice(0, 2));
}

/** Parse a multiplier ("2", "2.5x", "2.50") into hundredths, or null. */
export function parseMult(text: string): number | null {
  const t = text.replace(/[x×\s,]/gi, '');
  if (!/^\d{1,5}(\.\d{0,2})?$/.test(t)) return null;
  const [w, f = ''] = t.split('.');
  return Number(w) * 100 + Number((f + '00').slice(0, 2));
}
