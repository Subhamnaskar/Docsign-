/**
 * Name similarity for identity checks (0-100). Indian records often differ in
 * order ("Kumar Ravi"), initials ("R. Kumar"), titles ("Shri", "Mr") and
 * spelling ("Mohammad" / "Mohammed"), so tokens are compared order-free,
 * initials match their full name, and close spellings count partially.
 */

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'shri', 'sri', 'smt', 'kumari', 'km', 'prof', 'late', 'mx']);

export function nameTokens(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !TITLES.has(t));
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

function tokenScore(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 1 || b.length === 1) return a[0] === b[0] ? 0.8 : 0;
  const d = levenshtein(a, b);
  const sim = 1 - d / Math.max(a.length, b.length);
  return sim >= 0.75 ? sim : 0;
}

export function nameMatch(a: string, b: string): number {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (!x.length || !y.length) return 0;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const used = new Set<number>();
  let total = 0;
  for (const t of short) {
    let best = 0;
    let bestIdx = -1;
    long.forEach((u, i) => {
      if (used.has(i)) return;
      const s = tokenScore(t, u);
      if (s > best) {
        best = s;
        bestIdx = i;
      }
    });
    if (bestIdx >= 0) used.add(bestIdx);
    total += best;
  }
  // Missing middle names cost a little, not everything
  const coverage = total / short.length;
  const lengthPenalty = 1 - Math.min(0.2, (long.length - short.length) * 0.1);
  return Math.round(coverage * lengthPenalty * 100);
}

export const ID_CHECKS = ['PAN', 'BANK', 'DIGILOCKER', 'VIDEO'] as const;
export type IdCheck = (typeof ID_CHECKS)[number];

/** Score at or above which a name counts as matching. */
export const NAME_MATCH_THRESHOLD = 70;
