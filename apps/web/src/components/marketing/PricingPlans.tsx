'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Check } from '@/components/marketing/Site';
import { plans as copy } from '@/lib/brand';
import { cx } from '@/lib/cx';

type Currency = 'INR' | 'USD';

export interface PricingData {
  trial: { days: number; envelopes: number; seats: number };
  yearlyMonths: number;
  gstRate: number;
  plans: { id: 'starter' | 'business' | 'enterprise'; name: string; envelopesPerSeat: number | null; maxSeats: number | null; price: Record<Currency, number> | null }[];
}

const money = (minor: number, currency: Currency) =>
  new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);

function Toggle<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={cx('rounded-md px-3 py-1.5 font-medium', value === v ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900')}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Plan cards. `data` is null when the API is unreachable (e.g. during a build): prices then show "Contact us". */
export function PricingPlans({ data }: { data: PricingData | null }) {
  const [currency, setCurrency] = useState<Currency>('INR');
  const [yearly, setYearly] = useState(false);

  return (
    <>
      {data && (
        <div className="mb-8 flex flex-wrap items-center justify-center gap-3">
          <Toggle label="Currency" value={currency} onChange={setCurrency} options={[['INR', '₹ INR'], ['USD', '$ USD']]} />
          <Toggle
            label="Billing period"
            value={yearly ? 'year' : 'month'}
            onChange={(v) => setYearly(v === 'year')}
            options={[['month', 'Monthly'], ['year', `Yearly · ${12 - data.yearlyMonths} months free`]]}
          />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        {copy.map((c) => {
          const p = data?.plans.find((x) => x.id === c.id);
          const name = p?.name ?? c.id[0].toUpperCase() + c.id.slice(1);
          // Yearly: the per-month equivalent of paying for `yearlyMonths` months
          const perMonth = p?.price ? Math.round((p.price[currency] * (yearly ? data!.yearlyMonths : 12)) / 12) : null;
          return (
            <div
              key={c.id}
              className={cx('flex flex-col rounded-2xl border bg-white p-7', c.highlighted ? 'border-brand-500 shadow-lg ring-1 ring-brand-500' : 'border-gray-200')}
            >
              {c.highlighted && <span className="mb-3 self-start rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">Most popular</span>}
              <h2 className="text-xl font-semibold text-gray-900">{name}</h2>
              <p className="mt-1 text-sm text-gray-500">{c.audience}</p>
              <div className="mt-6 min-h-[64px]">
                {perMonth !== null ? (
                  <>
                    <span className="text-4xl font-bold text-gray-900">{money(perMonth, currency)}</span>
                    <span className="ml-1 text-sm text-gray-500">per user / month</span>
                    <p className="mt-1 text-xs text-gray-500">
                      {yearly ? `Billed yearly at ${money(p!.price![currency] * data!.yearlyMonths, currency)} per user` : 'Billed monthly'}
                      {currency === 'INR' && data!.gstRate > 0 ? ` · plus ${data!.gstRate}% GST` : ''}
                    </p>
                  </>
                ) : (
                  <span className="text-2xl font-semibold text-gray-900">{c.id === 'enterprise' ? 'Custom' : 'Contact us'}</span>
                )}
              </div>
              <ul className="mt-6 flex-1 space-y-3 text-sm text-gray-700">
                {p && (
                  <Check>
                    {p.envelopesPerSeat === null ? 'Unlimited agreements' : `${p.envelopesPerSeat} agreements per user each month`}
                    {p.maxSeats !== null ? `, up to ${p.maxSeats} users` : ''}
                  </Check>
                )}
                {c.features.map((f) => (
                  <Check key={f}>{f}</Check>
                ))}
              </ul>
              <Link
                href={c.cta.href}
                className={cx(
                  'mt-8 rounded-lg px-4 py-3 text-center text-sm font-semibold',
                  c.highlighted ? 'bg-brand-600 text-white hover:bg-brand-700' : 'border border-gray-300 text-gray-800 hover:bg-gray-50',
                )}
              >
                {c.cta.label}
              </Link>
            </div>
          );
        })}
      </div>
      {data && (
        <p className="mt-6 text-center text-sm text-gray-500">
          Every plan starts with a {data.trial.days}-day free trial: up to {data.trial.envelopes} agreements and {data.trial.seats} users, no card needed.
        </p>
      )}
    </>
  );
}
