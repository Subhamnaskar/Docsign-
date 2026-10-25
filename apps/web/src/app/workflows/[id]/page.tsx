'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppShell, useMe } from '@/components/AppShell';
import { Icon } from '@/components/marketing/Icons';
import { Alert, Button, Card, cx, Input, Label, PageLoader, Select } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDate, relativeTime } from '@/lib/format';
import { type Action, ACTION_LABELS, blankAction, type Condition, type ConditionField, RECIPES, TRIGGER_LABELS, type Trigger, type WorkflowDraft } from '@/lib/workflows';

interface Options {
  triggers: { id: Trigger; name: string }[];
  conditionFields: { id: ConditionField; name: string }[];
  actions: { id: Action['type']; name: string }[];
  templates: { id: string; name: string }[];
  folders: { id: string; name: string }[];
  departments: { id: string; name: string }[];
}
interface Run {
  id: string;
  event: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  attempts: number;
  results: { type: Action['type']; ok: boolean; detail: string }[] | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  envelope: { id: string; title: string } | null;
}

const DOC_TYPES = ['general', 'nda', 'employment', 'sales', 'lease', 'loan', 'consumer', 'procurement'];
const JURISDICTIONS = ['IN', 'US', 'UK', 'EU'];

const EMPTY: WorkflowDraft = { name: '', description: '', enabled: true, trigger: 'envelope.completed', conditions: [], actions: [] };

export default function WorkflowPage() {
  return (
    <AppShell wide>
      <WorkflowEditor />
    </AppShell>
  );
}

function WorkflowEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const me = useMe();
  const admin = me?.user?.role === 'OWNER' || me?.user?.role === 'ADMIN';
  const isNew = id === 'new';
  const [options, setOptions] = useState<Options | null>(null);
  const [draft, setDraft] = useState<WorkflowDraft | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (isNew) {
      const recipe = RECIPES.find((r) => r.id === new URLSearchParams(window.location.search).get('recipe'));
      setDraft(recipe ? structuredClone(recipe.draft) : { ...EMPTY, actions: [blankAction('email_copy')] });
      return;
    }
    const w = await api<WorkflowDraft & { runs: Run[] }>(`/workflows/${id}`);
    setDraft({ name: w.name, description: w.description ?? '', enabled: w.enabled, trigger: w.trigger, conditions: w.conditions, actions: w.actions });
    setRuns(w.runs);
  }, [id, isNew]);
  useEffect(() => {
    api<Options>('/workflows/options').then(setOptions);
    load().catch(() => setNotice({ tone: 'error', text: 'Workflow not found.' }));
  }, [load]);

  if (!options || !draft) return notice ? <Alert>{notice.text}</Alert> : <PageLoader />;
  const set = (patch: Partial<WorkflowDraft>) => setDraft({ ...draft, ...patch });
  const setCondition = (i: number, patch: Partial<Condition>) => set({ conditions: draft.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const setAction = (i: number, a: Action) => set({ actions: draft.actions.map((x, j) => (j === i ? a : x)) });

  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      const json = { ...draft!, description: draft!.description || null };
      if (isNew) {
        const w = await api<{ id: string }>('/workflows', { method: 'POST', json });
        router.replace(`/workflows/${w.id}`);
      } else {
        await api(`/workflows/${id}`, { method: 'PUT', json });
        setNotice({ tone: 'success', text: 'Workflow saved.' });
      }
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof ApiError ? e.message : 'Could not save the workflow.' });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${draft!.name}"? Its run history is deleted too.`)) return;
    await api(`/workflows/${id}`, { method: 'DELETE' });
    router.replace('/workflows');
  }

  const fieldValueInput = (c: Condition, i: number) => {
    const pick = (items: { id: string; name: string }[]) => (
      <Select value={c.value} onChange={(e) => setCondition(i, { value: e.target.value })} aria-label="Value">
        <option value="">Choose…</option>
        {items.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </Select>
    );
    if (c.field === 'templateId') return pick(options.templates);
    if (c.field === 'folderId') return pick(options.folders);
    if (c.field === 'departmentId') return pick(options.departments);
    if (c.field === 'documentType') return pick(DOC_TYPES.map((d) => ({ id: d, name: d })));
    if (c.field === 'jurisdiction') return pick(JURISDICTIONS.map((d) => ({ id: d, name: d })));
    return <Input value={c.value} onChange={(e) => setCondition(i, { value: e.target.value })} placeholder="e.g. NDA" aria-label="Value" />;
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/workflows" className="text-sm text-gray-500 hover:text-ink">
          ← Workflows
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{isNew ? 'New workflow' : draft.name}</h1>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <fieldset disabled={!admin} className="space-y-0">
          <Card className="p-5">
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <div>
                <Label htmlFor="wf-name">Name</Label>
                <Input id="wf-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Email signed NDAs to legal" />
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm font-medium text-gray-700">
                <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
                Active
              </label>
            </div>
            <div className="mt-3">
              <Label htmlFor="wf-desc" hint="optional">
                Description
              </Label>
              <Input id="wf-desc" value={draft.description} onChange={(e) => set({ description: e.target.value })} />
            </div>
          </Card>

          <Step label="When" tone="night">
            <Select value={draft.trigger} onChange={(e) => set({ trigger: e.target.value as Trigger })} aria-label="Trigger">
              {options.triggers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Step>

          <Step label="If" tone="gray" note={draft.conditions.length ? 'All conditions must match' : 'Runs for every agreement'}>
            <div className="space-y-2">
              {draft.conditions.map((c, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_0.8fr_1.2fr_auto]">
                  <Select value={c.field} onChange={(e) => setCondition(i, { field: e.target.value as ConditionField, value: '' })} aria-label="Field">
                    {options.conditionFields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                  <Select value={c.op} onChange={(e) => setCondition(i, { op: e.target.value as Condition['op'] })} aria-label="Operator">
                    <option value="equals">is</option>
                    <option value="not_equals">is not</option>
                    {c.field === 'title' && <option value="contains">contains</option>}
                  </Select>
                  {fieldValueInput(c, i)}
                  <Button variant="ghost" size="sm" onClick={() => set({ conditions: draft.conditions.filter((_, j) => j !== i) })} aria-label="Remove condition">
                    ✕
                  </Button>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => set({ conditions: [...draft.conditions, { field: 'title', op: 'contains', value: '' }] })}>
                + Add condition
              </Button>
            </div>
          </Step>

          <Step label="Then" tone="gold" last>
            <div className="space-y-3">
              {draft.actions.map((a, i) => (
                <div key={i} className="rounded-xl border border-gray-200 bg-white p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{i + 1}</span>
                    <div className="flex-1">
                      <Select value={a.type} onChange={(e) => setAction(i, blankAction(e.target.value as Action['type']))} aria-label="Action">
                        {options.actions.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => set({ actions: draft.actions.filter((_, j) => j !== i) })} aria-label="Remove action">
                      ✕
                    </Button>
                  </div>
                  <div className="mt-2 pl-8">
                    <ActionSettings action={a} options={options} onChange={(x) => setAction(i, x)} />
                  </div>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => set({ actions: [...draft.actions, blankAction('email_copy')] })}>
                + Add action
              </Button>
            </div>
          </Step>

          {admin && (
            <div className="mt-6 flex items-center justify-between gap-2">
              {!isNew ? (
                <Button variant="ghost" className="text-red-700" onClick={remove}>
                  Delete workflow
                </Button>
              ) : (
                <span />
              )}
              <Button loading={busy} disabled={!draft.name.trim() || draft.actions.length === 0} onClick={save}>
                {isNew ? 'Create workflow' : 'Save changes'}
              </Button>
            </div>
          )}
        </fieldset>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="font-semibold">How it works</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-gray-600">
              <li>The workflow runs a few seconds after the event, with retries if a step fails.</li>
              <li>&ldquo;Email a copy&rdquo; attaches the signed PDFs and certificate when the agreement is completed.</li>
              <li>&ldquo;Send another agreement&rdquo; matches the template&apos;s roles to the signers in signing order.</li>
              <li>Agreements started by a workflow don&apos;t trigger workflows, so nothing loops.</li>
            </ul>
          </Card>
          {!isNew && admin && <TestRun id={id} onQueued={() => setTimeout(() => load(), 4000)} />}
          {!isNew && <RunHistory runs={runs} onRefresh={load} />}
        </div>
      </div>
    </div>
  );
}

function Step({ label, tone, note, last, children }: { label: string; tone: 'night' | 'gray' | 'gold'; note?: string; last?: boolean; children: ReactNode }) {
  return (
    <div className="relative pl-12 pt-6">
      <span className="absolute left-[16px] top-0 h-6 w-px bg-gray-300" aria-hidden />
      {!last && <span className="absolute bottom-0 left-[16px] top-14 w-px bg-gray-300" aria-hidden />}
      <span
        className={cx(
          'absolute -left-1.5 top-7 flex h-8 min-w-[44px] items-center justify-center rounded-full px-1.5 text-[9px] font-bold uppercase tracking-wide',
          tone === 'night' ? 'bg-night text-white' : tone === 'gold' ? 'bg-gold text-ink' : 'bg-gray-200 text-gray-700',
        )}
      >
        {label}
      </span>
      <Card className="p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-semibold">{label}</h2>
          {note && <span className="text-xs text-gray-500">{note}</span>}
        </div>
        <div className="mt-3">{children}</div>
      </Card>
    </div>
  );
}

function ActionSettings({ action: a, options, onChange }: { action: Action; options: Options; onChange: (a: Action) => void }) {
  switch (a.type) {
    case 'email_copy':
      return (
        <Input
          value={a.to.join(', ')}
          onChange={(e) =>
            onChange({
              ...a,
              to: e.target.value
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean),
            })
          }
          placeholder="legal@company.com, finance@company.com"
          aria-label="Email addresses"
        />
      );
    case 'move_to_folder':
      return (
        <Select value={a.folderId} onChange={(e) => onChange({ ...a, folderId: e.target.value })} aria-label="Folder">
          <option value="">{options.folders.length ? 'Choose a folder…' : 'Create a folder on the Agreements page first'}</option>
          {options.folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
      );
    case 'add_tag':
      return <Input value={a.tag} onChange={(e) => onChange({ ...a, tag: e.target.value })} placeholder="e.g. signed" aria-label="Tag" />;
    case 'send_template':
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          <Select value={a.templateId} onChange={(e) => onChange({ ...a, templateId: e.target.value })} aria-label="Template">
            <option value="">{options.templates.length ? 'Choose a template…' : 'Save a template first'}</option>
            {options.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Input value={a.title ?? ''} onChange={(e) => onChange({ ...a, title: e.target.value || undefined })} placeholder="Title (optional)" aria-label="Title" />
        </div>
      );
    case 'notify_chat':
      return (
        <div className="grid gap-2 sm:grid-cols-[0.6fr_2fr]">
          <Select value={a.format} onChange={(e) => onChange({ ...a, format: e.target.value as 'slack' | 'teams' })} aria-label="Chat app">
            <option value="slack">Slack</option>
            <option value="teams">Microsoft Teams</option>
          </Select>
          <Input value={a.url} onChange={(e) => onChange({ ...a, url: e.target.value })} placeholder={a.format === 'slack' ? 'https://hooks.slack.com/services/…' : 'Teams incoming webhook URL'} aria-label="Webhook URL" />
        </div>
      );
  }
}

function TestRun({ id, onQueued }: { id: string; onQueued: () => void }) {
  const [envelopes, setEnvelopes] = useState<{ id: string; title: string; status: string }[]>([]);
  const [chosen, setChosen] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    api<{ data: { id: string; title: string; status: string }[] }>('/envelopes?limit=30').then((r) => setEnvelopes(r.data));
  }, []);
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Test run</h2>
      <p className="mt-1 text-sm text-gray-500">Run the actions now on one agreement, ignoring the trigger and conditions.</p>
      <div className="mt-3 flex gap-2">
        <div className="flex-1">
          <Select value={chosen} onChange={(e) => setChosen(e.target.value)} aria-label="Agreement">
            <option value="">Choose an agreement…</option>
            {envelopes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} ({e.status.toLowerCase()})
              </option>
            ))}
          </Select>
        </div>
        <Button
          variant="secondary"
          disabled={!chosen}
          onClick={async () => {
            await api(`/workflows/${id}/test`, { method: 'POST', json: { envelopeId: chosen } });
            setMsg('Queued. The result appears in the run history in a few seconds.');
            onQueued();
          }}
        >
          Run
        </Button>
      </div>
      {msg && <p className="mt-2 text-sm text-emerald-700">{msg}</p>}
    </Card>
  );
}

function RunHistory({ runs, onRefresh }: { runs: Run[]; onRefresh: () => void }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Run history</h2>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          Refresh
        </Button>
      </div>
      <ul className="mt-3 divide-y divide-gray-100">
        {runs.map((r) => (
          <li key={r.id} className="py-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                {r.envelope ? (
                  <Link href={`/envelopes/${r.envelope.id}`} className="font-medium text-ink hover:underline">
                    {r.envelope.title}
                  </Link>
                ) : (
                  '—'
                )}
                <span className="block text-xs text-gray-500" title={formatDate(r.createdAt)}>
                  {TRIGGER_LABELS[r.event as Trigger] ?? r.event} · {relativeTime(r.createdAt)}
                  {r.attempts > 1 && ` · ${r.attempts} attempts`}
                </span>
              </span>
              <span
                className={cx(
                  'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                  r.status === 'SUCCEEDED' ? 'bg-emerald-50 text-emerald-700' : r.status === 'FAILED' ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600',
                )}
              >
                {r.status === 'SUCCEEDED' ? 'Done' : r.status === 'FAILED' ? 'Failed' : 'Waiting'}
              </span>
            </div>
            {r.results && r.results.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 pl-1">
                {r.results.map((x, i) => (
                  <li key={i} className={cx('flex items-start gap-1.5 text-xs', x.ok ? 'text-gray-600' : 'text-red-700')}>
                    <Icon name={x.ok ? 'check' : 'arrow'} className="mt-0.5 h-3 w-3 shrink-0" />
                    {ACTION_LABELS[x.type]}: {x.detail}
                  </li>
                ))}
              </ul>
            )}
            {r.error && r.status !== 'SUCCEEDED' && <p className="mt-1 text-xs text-red-700">{r.error}</p>}
          </li>
        ))}
        {runs.length === 0 && <li className="py-6 text-center text-sm text-gray-500">No runs yet.</li>}
      </ul>
    </Card>
  );
}
