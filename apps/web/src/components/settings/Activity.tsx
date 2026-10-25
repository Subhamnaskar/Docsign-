'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Entry {
  id: string;
  type: string;
  actor: { kind: string; name?: string; email?: string };
  data: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

const LABELS: Record<string, string> = {
  'user.invited': 'Invited a user',
  'user.joined': 'Joined the organisation',
  'user.updated': 'Changed a user',
  'invitation.revoked': 'Revoked an invitation',
  'api_key.created': 'Created an API key',
  'api_key.revoked': 'Revoked an API key',
  'webhook.created': 'Added a webhook',
  'webhook.deleted': 'Deleted a webhook',
  'organization.updated': 'Updated organisation settings',
  'branding.logo_updated': 'Uploaded a logo',
  'branding.logo_removed': 'Removed the logo',
  'sso.updated': 'Changed single sign-on',
  'platform.trial_extended': 'NuronixAI support extended the free trial',
  'platform.plan_changed': 'NuronixAI support changed the plan',
  'platform.user_signed_out': 'NuronixAI support signed a user out',
  'platform.user_deactivated': 'NuronixAI support deactivated a user',
  'platform.user_reactivated': 'NuronixAI support reactivated a user',
  'platform.password_reset_sent': 'NuronixAI support sent a password reset',
  'platform.org_suspended': 'NuronixAI suspended the organisation',
  'platform.org_reactivated': 'NuronixAI reactivated the organisation',
  'platform.org_signed_out': 'NuronixAI support signed everyone out',
  'platform.subscription_canceled': 'NuronixAI support cancelled the subscription',
  'platform.refund_issued': 'NuronixAI issued a refund',
  'platform.credit_issued': 'NuronixAI issued an account credit',
  'platform.support_session_started': 'NuronixAI support started viewing the account',
  'platform.support_session_ended': 'NuronixAI support stopped viewing the account',
  'support_access.granted': 'Allowed NuronixAI support access',
  'support_access.revoked': 'Turned off NuronixAI support access',
};

function summary(e: Entry): string {
  const d = e.data;
  if (typeof d.email === 'string') return d.email;
  if (typeof d.name === 'string') return d.name;
  if (typeof d.url === 'string') return d.url;
  return '';
}

/** Organisation-level admin log: who changed users, keys and settings. */
export function ActivityLog() {
  const [items, setItems] = useState<Entry[] | null>(null);
  useEffect(() => {
    api<Entry[]>('/activity').then(setItems);
  }, []);
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Activity</h2>
      <p className="mt-1 text-sm text-gray-500">Changes to users, keys, webhooks and settings. Agreement events are in each agreement&apos;s audit trail.</p>
      <ul className="mt-4 divide-y divide-gray-100 text-sm">
        {items?.length === 0 && <li className="py-3 text-gray-500">No activity yet.</li>}
        {items?.map((e) => (
          <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 py-2.5">
            <span className="font-medium">{LABELS[e.type] ?? e.type}</span>
            <span className="text-gray-500">{summary(e)}</span>
            <span className="ml-auto text-xs text-gray-400">
              {e.actor.name ?? 'API'} · {formatDate(e.createdAt)}
              {e.ip && ` · ${e.ip}`}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
