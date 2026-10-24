import type { Policy } from '@/lib/types';
import { cx } from './ui';

const LEVEL_NAMES = { SES: 'Simple (SES)', AES: 'Advanced (AES)', QES: 'Qualified (QES)' };

/** Shows what the policy engine decided for this envelope. */
export function CompliancePanel({ policy, compact }: { policy: Policy; compact?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm shadow-sm">
      <div className="flex items-center gap-2">
        <span className={cx('h-2.5 w-2.5 rounded-full', policy.allowed ? 'bg-green-500' : 'bg-red-500')} />
        <h3 className="font-semibold text-gray-900">Compliance profile</h3>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-gray-600">
        <dt className="text-gray-400">Jurisdiction</dt>
        <dd>{policy.jurisdictionName}</dd>
        <dt className="text-gray-400">Signature level</dt>
        <dd>{LEVEL_NAMES[policy.signatureLevel]}</dd>
        <dt className="text-gray-400">Signer check</dt>
        <dd>{policy.identityProvider === 'email-otp' ? 'Email one-time passcode' : (policy.identityProvider ?? 'Not available')}</dd>
        <dt className="text-gray-400">Seal format</dt>
        <dd>{policy.signatureFormat}</dd>
        {!compact && (
          <>
            <dt className="text-gray-400">Retention</dt>
            <dd>{policy.retentionYears} years, write-once</dd>
            <dt className="text-gray-400">Data region</dt>
            <dd className="uppercase">{policy.dataRegion}</dd>
            <dt className="text-gray-400">Law</dt>
            <dd>{policy.laws.join('; ')}</dd>
          </>
        )}
      </dl>
      {policy.blockers.length > 0 && (
        <ul className="mt-3 space-y-1.5 rounded-lg bg-red-50 p-3 text-red-800">
          {policy.blockers.map((b) => (
            <li key={b}>⛔ {b}</li>
          ))}
        </ul>
      )}
      {policy.warnings.length > 0 && (
        <ul className="mt-3 space-y-1.5 rounded-lg bg-amber-50 p-3 text-amber-900">
          {policy.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
