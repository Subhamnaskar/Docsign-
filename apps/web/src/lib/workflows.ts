/** Workflow shapes shared by the list and the builder (mirrors apps/api/src/workflows/engine.ts). */

export type Trigger = 'envelope.sent' | 'recipient.viewed' | 'recipient.signed' | 'recipient.declined' | 'envelope.completed' | 'envelope.voided' | 'envelope.expired';
export type ConditionField = 'title' | 'documentType' | 'jurisdiction' | 'templateId' | 'departmentId' | 'folderId';
export interface Condition {
  field: ConditionField;
  op: 'equals' | 'not_equals' | 'contains';
  value: string;
}
export type Action =
  | { type: 'email_copy'; to: string[] }
  | { type: 'move_to_folder'; folderId: string }
  | { type: 'add_tag'; tag: string }
  | { type: 'send_template'; templateId: string; title?: string }
  | { type: 'notify_chat'; format: 'slack' | 'teams'; url: string };

export interface WorkflowDraft {
  name: string;
  description: string;
  enabled: boolean;
  trigger: Trigger;
  conditions: Condition[];
  actions: Action[];
}

export interface Workflow extends WorkflowDraft {
  id: string;
  runCount: number;
  lastRunAt: string | null;
  failedThisWeek?: number;
  createdAt: string;
}

export const TRIGGER_LABELS: Record<Trigger, string> = {
  'envelope.sent': 'An agreement is sent',
  'recipient.viewed': 'A signer opens an agreement',
  'recipient.signed': 'A signer signs',
  'recipient.declined': 'A signer declines',
  'envelope.completed': 'An agreement is completed',
  'envelope.voided': 'An agreement is voided',
  'envelope.expired': 'An agreement expires',
};

export const ACTION_LABELS: Record<Action['type'], string> = {
  email_copy: 'Email a copy',
  move_to_folder: 'Move to a folder',
  add_tag: 'Add a repository tag',
  send_template: 'Send another agreement from a template',
  notify_chat: 'Post to Slack or Teams',
};

export const blankAction = (type: Action['type']): Action =>
  type === 'email_copy'
    ? { type, to: [] }
    : type === 'move_to_folder'
      ? { type, folderId: '' }
      : type === 'add_tag'
        ? { type, tag: '' }
        : type === 'send_template'
          ? { type, templateId: '' }
          : { type, format: 'slack', url: '' };

/** Ready-made starting points offered on the Workflows page. */
export const RECIPES: { id: string; name: string; description: string; draft: WorkflowDraft }[] = [
  {
    id: 'legal-copy',
    name: 'Email signed NDAs to legal',
    description: 'When an NDA is completed, send legal the signed PDF and certificate.',
    draft: {
      name: 'Email signed NDAs to legal',
      description: '',
      enabled: true,
      trigger: 'envelope.completed',
      conditions: [{ field: 'documentType', op: 'equals', value: 'nda' }],
      actions: [{ type: 'email_copy', to: [] }],
    },
  },
  {
    id: 'file-completed',
    name: 'File and tag completed agreements',
    description: 'Move every completed agreement into a folder and tag it in the repository.',
    draft: { name: 'File completed agreements', description: '', enabled: true, trigger: 'envelope.completed', conditions: [], actions: [{ type: 'move_to_folder', folderId: '' }, { type: 'add_tag', tag: 'signed' }] },
  },
  {
    id: 'nda-then-msa',
    name: 'Send the MSA after the NDA',
    description: 'When an NDA is completed, send the same people your MSA template.',
    draft: {
      name: 'Send the MSA after the NDA',
      description: '',
      enabled: true,
      trigger: 'envelope.completed',
      conditions: [{ field: 'title', op: 'contains', value: 'NDA' }],
      actions: [{ type: 'send_template', templateId: '' }],
    },
  },
  {
    id: 'slack-deals',
    name: 'Tell Slack when a deal is signed',
    description: 'Post to a Slack channel whenever an agreement is completed.',
    draft: { name: 'Tell Slack about signed deals', description: '', enabled: true, trigger: 'envelope.completed', conditions: [], actions: [{ type: 'notify_chat', format: 'slack', url: '' }] },
  },
  {
    id: 'declined-alert',
    name: 'Alert the team when someone declines',
    description: 'Email the team straight away when a signer declines.',
    draft: { name: 'Declined alert', description: '', enabled: true, trigger: 'recipient.declined', conditions: [], actions: [{ type: 'email_copy', to: [] }] },
  },
];
