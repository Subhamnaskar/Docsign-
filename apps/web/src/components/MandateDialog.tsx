'use client';

import { useState } from 'react';
import { Alert, Button, Input, Label, Modal } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { Field } from '@/lib/types';

const FREQUENCY: Record<string, string> = { MONTHLY: 'monthly', QUARTERLY: 'quarterly', HALF_YEARLY: 'half-yearly', YEARLY: 'yearly', AS_PRESENTED: 'as presented' };

/** Collects the bank account for an eNACH mandate and hands over to the bank's approval page. */
export function MandateDialog({ token, field, defaultHolder, onClose }: { token: string; field: Field; defaultHolder: string; onClose: () => void }) {
  const [accountNumber, setAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [accountHolder, setHolder] = useState(defaultHolder);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const months = field.config?.months ?? 12;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>(`/signing/${token}/mandates/${field.id}/start`, { method: 'POST', json: { accountNumber, ifsc, accountHolder } });
      window.location.assign(url);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Set up eNACH auto-debit">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-gray-600">
          You authorise debits of up to <strong>{formatMoney(field.amount ?? 0, 'INR')}</strong> {FREQUENCY[field.config?.frequency ?? 'MONTHLY']} for {months} month
          {months === 1 ? '' : 's'}. Your bank will ask you to approve it with net banking or your debit card.
        </p>
        {error && <Alert>{error}</Alert>}
        <div>
          <Label htmlFor="m-holder">Account holder name</Label>
          <Input id="m-holder" value={accountHolder} onChange={(e) => setHolder(e.target.value)} required />
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
          <div>
            <Label htmlFor="m-acc">Account number</Label>
            <Input id="m-acc" inputMode="numeric" autoComplete="off" value={accountNumber} onChange={(e) => setAccount(e.target.value.replace(/\D/g, ''))} required />
          </div>
          <div>
            <Label htmlFor="m-ifsc">IFSC</Label>
            <Input id="m-ifsc" className="font-mono uppercase" maxLength={11} value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} required />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Continue to bank
          </Button>
        </div>
      </form>
    </Modal>
  );
}
