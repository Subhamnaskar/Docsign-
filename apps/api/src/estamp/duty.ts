/**
 * Stamp duty calculator (India). Duty depends on the state's Stamp Act
 * schedule, the instrument and, for some instruments, the amount involved.
 *
 * The rates below are INDICATIVE starting points for common instruments in a
 * few states. Schedules are amended often and have exceptions (concessions,
 * caps, district rules), so every figure must be confirmed against the current
 * state schedule (or with the e-stamp vendor) before buying a stamp. Add or
 * correct rules here; the engine needs no other change.
 */

export type Instrument = 'agreement' | 'affidavit' | 'indemnity' | 'rent' | 'loan';

export const INSTRUMENTS: Record<Instrument, string> = {
  agreement: 'Agreement or memorandum (not otherwise provided for)',
  affidavit: 'Affidavit',
  indemnity: 'Indemnity bond',
  rent: 'Lease / leave and licence (residential, up to 5 years)',
  loan: 'Loan or hypothecation agreement',
};

type Rule =
  | { kind: 'fixed'; amount: number; article: string }
  /** Percentage of the amount secured or the consideration, with optional floor and cap (rupees) */
  | { kind: 'percent'; rate: number; min?: number; max?: number; article: string }
  /** Percentage of total rent over the term plus notional interest on the deposit (leave and licence) */
  | { kind: 'termRent'; rate: number; depositInterestRate: number; min?: number; article: string }
  /** Percentage of the average annual rent */
  | { kind: 'annualRent'; rate: number; min?: number; article: string };

const RULES: Record<string, Partial<Record<Instrument, Rule>>> = {
  MH: {
    agreement: { kind: 'fixed', amount: 500, article: 'Article 5(h)(B)' },
    affidavit: { kind: 'fixed', amount: 500, article: 'Article 4' },
    indemnity: { kind: 'fixed', amount: 500, article: 'Article 34' },
    rent: { kind: 'termRent', rate: 0.0025, depositInterestRate: 0.1, min: 100, article: 'Article 36A (leave and licence)' },
    loan: { kind: 'percent', rate: 0.001, max: 1_000_000, article: 'Article 6' },
  },
  DL: {
    agreement: { kind: 'fixed', amount: 50, article: 'Article 5(c)' },
    affidavit: { kind: 'fixed', amount: 10, article: 'Article 4' },
    indemnity: { kind: 'fixed', amount: 100, article: 'Article 34' },
    rent: { kind: 'annualRent', rate: 0.02, article: 'Article 35' },
  },
  KA: {
    agreement: { kind: 'fixed', amount: 200, article: 'Article 5(j)' },
    affidavit: { kind: 'fixed', amount: 20, article: 'Article 4' },
    rent: { kind: 'annualRent', rate: 0.01, article: 'Article 30' },
  },
};

export interface DutyInput {
  state: string;
  instrument: Instrument;
  /** Loan amount or consideration, rupees */
  amount?: number;
  /** Rent instruments */
  monthlyRent?: number;
  months?: number;
  deposit?: number;
}

export interface DutyResult {
  state: string;
  instrument: Instrument;
  article: string;
  /** Rupees, rounded up to the next rupee */
  duty: number;
  basis: string;
  indicative: true;
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export function supportedDuty() {
  return Object.fromEntries(Object.entries(RULES).map(([state, rules]) => [state, Object.keys(rules)]));
}

export function calculateDuty(input: DutyInput): DutyResult | null {
  const rule = RULES[input.state]?.[input.instrument];
  if (!rule) return null;
  let duty: number;
  let basis: string;
  if (rule.kind === 'fixed') {
    duty = rule.amount;
    basis = `Fixed duty of ${inr(rule.amount)}`;
  } else if (rule.kind === 'percent') {
    const amount = input.amount ?? 0;
    duty = Math.min(rule.max ?? Infinity, Math.max(rule.min ?? 0, amount * rule.rate));
    basis = `${(rule.rate * 100).toFixed(2)}% of ${inr(amount)}${rule.max ? `, capped at ${inr(rule.max)}` : ''}`;
  } else if (rule.kind === 'termRent') {
    const months = input.months ?? 11;
    const rent = (input.monthlyRent ?? 0) * months;
    const depositInterest = (input.deposit ?? 0) * rule.depositInterestRate * (months / 12);
    duty = Math.max(rule.min ?? 0, (rent + depositInterest) * rule.rate);
    basis = `${(rule.rate * 100).toFixed(2)}% of rent over ${months} months (${inr(rent)}) plus ${rule.depositInterestRate * 100}% a year notional interest on the deposit`;
  } else {
    const annual = (input.monthlyRent ?? 0) * 12;
    duty = Math.max(rule.min ?? 0, annual * rule.rate);
    basis = `${(rule.rate * 100).toFixed(2)}% of average annual rent (${inr(annual)})`;
  }
  return { state: input.state, instrument: input.instrument, article: rule.article, duty: Math.ceil(duty), basis, indicative: true };
}
