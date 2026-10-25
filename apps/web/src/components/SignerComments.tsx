'use client';

import { useCallback, useEffect, useState } from 'react';
import { CommentThread, type CommentRow } from '@/components/Negotiation';
import { Modal } from '@/components/ui';
import { api } from '@/lib/api';

/** Signer side of negotiation: read the thread and ask for changes before signing. */
export function SignerComments({ token, open, onClose, documents }: { token: string; open: boolean; onClose: () => void; documents: { id: string; name: string; pageCount: number }[] }) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const load = useCallback(() => api<CommentRow[]>(`/signing/${token}/comments`).then(setComments), [token]);
  useEffect(() => {
    if (open) load().catch(() => {});
  }, [open, load]);
  return (
    <Modal open={open} onClose={onClose} title="Comments" wide>
      <p className="mb-3 text-sm text-gray-600">Ask the sender about a clause or request a change. They are notified by email and can send you a revised version.</p>
      <CommentThread
        comments={comments}
        documents={documents}
        onPost={async (input) => {
          await api(`/signing/${token}/comments`, { method: 'POST', json: input });
          await load();
        }}
      />
    </Modal>
  );
}
