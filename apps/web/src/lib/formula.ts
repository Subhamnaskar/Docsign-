// Copy of apps/api/src/lib/formula.ts for live previews while signing.
// The server recomputes every formula; this copy only affects what the signer sees.

/**
 * Tiny arithmetic evaluator for FORMULA fields: numbers, + - * /, parentheses
 * and {Field label} references. No eval; anything else is rejected.
 */

type Token = { t: 'num'; v: number } | { t: 'ref'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^[0-9]*\.?[0-9]+|^[0-9]+\.?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (ch === '{') {
      const end = src.indexOf('}', i);
      if (end === -1) throw new Error('Unclosed {');
      out.push({ t: 'ref', v: src.slice(i + 1, end).trim() });
      i = end + 1;
    } else if ('+-*/()'.includes(ch)) {
      out.push({ t: 'op', v: ch });
      i++;
    } else {
      throw new Error(`Unexpected "${ch}"`);
    }
  }
  return out;
}

/** References used by a formula, e.g. ["Qty", "Price"]. Throws if the syntax is invalid. */
export function formulaRefs(src: string): string[] {
  const tokens = tokenize(src);
  evaluateTokens(tokens, () => 1);
  return tokens.filter((t): t is { t: 'ref'; v: string } => t.t === 'ref').map((t) => t.v);
}

export function evaluateFormula(src: string, lookup: (label: string) => number | null): number | null {
  let missing = false;
  const value = evaluateTokens(tokenize(src), (label) => {
    const v = lookup(label);
    if (v === null || Number.isNaN(v)) missing = true;
    return v ?? 0;
  });
  if (missing || !Number.isFinite(value)) return null;
  // Avoid floating-point noise like 0.30000000000000004
  return Math.round(value * 1e6) / 1e6;
}

function evaluateTokens(tokens: Token[], ref: (label: string) => number): number {
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;

  // expr := term (('+' | '-') term)*
  const expr = (): number => {
    let v = term();
    while (isOp('+') || isOp('-')) {
      const op = tokens[pos++].v;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  // term := factor (('*' | '/') factor)*
  const term = (): number => {
    let v = factor();
    while (isOp('*') || isOp('/')) {
      const op = tokens[pos++].v;
      const r = factor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  // factor := number | ref | '-' factor | '(' expr ')'
  const factor = (): number => {
    const tok = tokens[pos++];
    if (!tok) throw new Error('Unexpected end of formula');
    if (tok.t === 'num') return tok.v;
    if (tok.t === 'ref') return ref(tok.v);
    if (tok.v === '-') return -factor();
    if (tok.v === '(') {
      const v = expr();
      if (!isOp(')')) throw new Error('Missing )');
      pos++;
      return v;
    }
    throw new Error(`Unexpected "${tok.v}"`);
  };

  const result = expr();
  if (pos !== tokens.length) throw new Error('Unexpected input after formula');
  return result;
}
