'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthCard } from '@/components/AuthCard';
import { Alert, Button, Input, Label, PageLoader } from '@/components/ui';
import { api } from '@/lib/api';

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>()!;
  const router = useRouter();
  const [invite, setInvite] = useState<{ email: string; organization: string; role: string } | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<typeof invite>(`/invitations/${token}`)
      .then(setInvite)
      .catch(() => setInvalid(true));
  }, [token]);

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api(`/invitations/${token}/accept`, { method: 'POST', json: { name, password } });
      router.replace('/dashboard');
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  if (invalid) {
    return (
      <AuthCard title="Invitation not valid">
        <p className="text-sm text-gray-600">This invitation has expired, was revoked or has already been used. Ask your administrator for a new one.</p>
      </AuthCard>
    );
  }
  if (!invite) return <PageLoader />;

  return (
    <AuthCard title={`Join ${invite.organization}`} subtitle={`You're invited as ${invite.role.toLowerCase()} with ${invite.email}.`}>
      <form onSubmit={accept} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <Label htmlFor="name">Your name</Label>
          <Input id="name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="password" hint="(10+ characters)">
            Choose a password
          </Label>
          <Input id="password" type="password" required minLength={10} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" loading={loading}>
          Accept and continue
        </Button>
      </form>
    </AuthCard>
  );
}
