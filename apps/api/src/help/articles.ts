/**
 * Help centre articles. The website renders them and the help assistant
 * answers from them, so this is the single source. Markdown subset: ## and ###
 * headings, paragraphs, "- " lists, "1. " lists, **bold**, `code` and [links](/path).
 */

export interface Article {
  slug: string;
  title: string;
  category: 'Getting started' | 'Sending' | 'Signing' | 'India' | 'Teams & security' | 'Developers' | 'Account';
  summary: string;
  body: string;
}

export const ARTICLES: Article[] = [
  {
    slug: 'getting-started',
    title: 'Get started in five minutes',
    category: 'Getting started',
    summary: 'Create your account, confirm your email and send your first agreement.',
    body: `## 1. Create your account
Go to [Start free](/register) and enter your name, work email and company. Every account starts with a 14-day free trial of all features: up to 25 agreements and 5 users, no card needed.

## 2. Confirm your email
We send a confirmation link when you sign up. You can prepare agreements straight away, but you need to confirm your email before sending. Use **Resend email** in the blue banner if it didn't arrive.

## 3. Send your first agreement
1. On **Agreements**, choose **New agreement**.
2. Upload a PDF, Word, Excel, PowerPoint, ODT, RTF or text file, or import it from Google Drive, Dropbox, OneDrive or a share link.
3. Add the people who need to sign, in the order they should sign.
4. Drag a **Signature** field (and any others) onto the document for each signer.
5. Review and choose **Send**.

Each signer gets an email with a personal link. When everyone has signed, you and the signers receive the sealed PDF and a certificate of completion.

## Next steps
- Add your logo and colour under **Settings → Branding**.
- Invite your team under **Settings → Team**.
- Save agreements you send often as [templates](/help/templates-and-bulk-send).`,
  },
  {
    slug: 'sending-an-agreement',
    title: 'Prepare and send an agreement',
    category: 'Sending',
    summary: 'Documents, recipients, signing order, fields, reminders and expiry.',
    body: `## Documents
Add one or more documents. Office files are converted to PDF automatically and every file is scanned for malware. The **compliance profile** on the right shows which signature level and checks the governing law needs; choose the jurisdiction and document type under **Details**.

## Recipients
- **Signer**: fills in fields and signs.
- **Approver**: reviews and approves without signing fields.
- **CC**: gets a copy when everyone has signed.

Give recipients a **signing order** (1, 2, 3…) to route the agreement one after another, or the same number to send in parallel. Choose how each signer proves who they are: an email code (default), an SMS or WhatsApp code, or an access code you share with them yourself.

## Fields
Drag fields from the palette onto each page and assign them to a signer. See the [field reference](/help/fields-reference).

## Reminders and expiry
Under **Details**, set automatic reminders (every N days) and an expiry date. You can also send a reminder at any time from the agreement page.

## After sending
- **Correct** a recipient's name or email; their old link stops working.
- **Upload revised version** of a document while nobody has signed; signers are asked to review it again.
- **Void** the agreement to cancel it.`,
  },
  {
    slug: 'fields-reference',
    title: 'Field types',
    category: 'Sending',
    summary: 'Every field you can place, from signatures to payments and eNACH mandates.',
    body: `## Signing fields
- **Signature** and **Initials**: drawn, typed or uploaded. The signer adopts it once and reuses it.
- **Date signed**: filled automatically when the signer finishes.
- **Name** and **Email**: filled from the recipient.

## Information
- **Text**, **Number**, **Checkbox**, **Dropdown** and **Radio** buttons.
- **Formula**: a calculated value from number fields, for example \`{Qty} * {Price}\`.
- **Attachment**: the signer uploads a supporting file (PDF or image). It is embedded in the signed PDF.

## Conditions
Any field can be shown only when another field has a certain value, for example show "Guarantor name" only when "Has guarantor" is ticked.

## Money
- **Payment**: the signer pays an amount (cards, UPI and more through your payment provider) before finishing.
- **eNACH mandate** (India): the signer authorises recurring debits from their bank account, for example loan EMIs. You set the maximum per debit, the frequency and how many months it runs.`,
  },
  {
    slug: 'signing-guide',
    title: 'How to sign an agreement',
    category: 'Signing',
    summary: 'For signers: open the link, confirm your identity, sign or ask for changes.',
    body: `## Open your link
The email "Please sign…" contains a personal link. Don't forward it: it is tied to you.

## Confirm it's you
Enter the code we send to your email or phone, or the access code the sender gave you. Some agreements also ask for **identity checks** such as your PAN, a bank account check, Aadhaar via DigiLocker or a short video selfie.

## Agree to sign electronically
Read the disclosure for your country and tick the box.

## Fill in and sign
Use **Next field** to jump to each field. Draw, type or upload your signature. Choose **Finish signing** when everything is done. You receive the sealed PDF by email once everyone has signed.

## Questions or changes
- **Comments**: ask the sender about a clause or request a change. They can reply or send a revised version.
- **Assign to someone else** if you are not the right person.
- **Decline** with a reason if you won't sign.

You can change the language of the signing page with the selector at the top.`,
  },
  {
    slug: 'templates-and-bulk-send',
    title: 'Templates, web forms and bulk send',
    category: 'Sending',
    summary: 'Reuse documents and field layouts, collect signatures from a link, or send to hundreds of people.',
    body: `## Templates
Open any agreement and choose **Save as template**. Name the roles (for example "Employee" and "Manager"). Next time, choose **Use** on the Templates page and enter who fills each role.

## Bulk send
On a template, choose **Bulk send** and upload a CSV with one row per agreement (name and email per role). Up to 100 rows per batch; you get a per-row result.

## Web forms
Turn a template into a public signing link (a web form). Anyone with the link fills in their details and signs; the agreement is created and routed automatically.

## Word templates
Generate agreements from Word documents with placeholders. See [Word templates](/help/word-templates).`,
  },
  {
    slug: 'word-templates',
    title: 'Generate agreements from Word templates',
    category: 'Sending',
    summary: 'Put {{placeholders}} in a .docx and fill them in to create ready-to-send agreements.',
    body: `## Make the template
In Word, type placeholders in double curly brackets where values go, for example \`{{Client name}}\`, \`{{Fee}}\` or \`{{Start date}}\`. Keep each placeholder in the same formatting (don't make half of it bold).

## Upload it
On **Templates**, under **Word templates**, choose **Upload .docx**. We list the placeholders we found.

## Generate an agreement
Choose **Generate**, fill in the values and choose **Create agreement**. The filled document is converted to PDF and added to a new draft, ready for recipients and fields.

## From your systems
Developers can call \`POST /api/v1/doc-templates/{id}/generate\` with the values, for example from a CRM.`,
  },
  {
    slug: 'india-identity-checks',
    title: 'Identity checks, eNACH and e-stamping (India)',
    category: 'India',
    summary: 'PAN, bank account, DigiLocker and video checks before signing; recurring debits; stamp duty.',
    body: `## Identity checks before signing
For each recipient, choose the checks they must pass before the document opens:
- **PAN**: the PAN must be valid and the name on it must match the recipient's name.
- **Bank account**: a penny-drop check that the account exists and the holder's name matches.
- **Aadhaar via DigiLocker**: the signer shares their Aadhaar details from DigiLocker. We keep only the name, year of birth and last 4 digits.
- **Video selfie**: the signer records a short video reading out a code shown on screen. You can watch it on the agreement page.

Name matching tolerates order, initials, titles and small spelling differences. Results (with identifiers masked) appear on the agreement page and in the audit trail.

## eNACH mandates
Add an **eNACH mandate** field to collect authorisation for recurring debits. The signer enters their bank account and approves the mandate with their bank; the UMRN is recorded on the document.

## e-Stamping
Turn on **e-Stamp** for agreements that need stamp duty. Use **Calculate duty** for an indicative amount for common instruments in some states, then confirm it against the current state schedule. The e-stamp certificate is added as page 1 when you send.`,
  },
  {
    slug: 'aadhaar-esign-and-dsc',
    title: 'Aadhaar eSign and DSC tokens',
    category: 'India',
    summary: 'Advanced electronic signatures under the IT Act for loans and other regulated documents.',
    body: `## When to use them
Some documents, such as loan agreements, need an advanced signature. The compliance profile tells you when. For a recipient, set **Sign with** to **Aadhaar eSign** or **DSC token**.

## Aadhaar eSign
The signer enters their Aadhaar number or VID and the OTP sent to their Aadhaar-linked mobile. A licensed eSign service provider issues a one-time certificate and signs the document.

## DSC tokens
Directors and authorised signatories with a Class 3 digital signature certificate on a USB token sign through a small desktop utility.

## Each signature stays valid
Signatures are added as incremental PDF updates, so every earlier signature still validates in Adobe Reader and other tools.`,
  },
  {
    slug: 'verify-a-document',
    title: 'Verify a signed document',
    category: 'Signing',
    summary: 'Check that a PDF is authentic and unaltered, and what long-term validation means.',
    body: `## Anyone can verify
Go to [Verify](/verify) and drop in a signed PDF or certificate of completion. Nothing is stored. We check:
- the fingerprint matches a completed record,
- every digital signature is cryptographically valid,
- nothing was changed after signing,
- the trusted timestamps,
- the audit trail's hash chain.

## Long-term validation
Signed PDFs include the certificates and revocation status needed to validate them years later (PAdES B-LT), plus an archive timestamp (B-LTA) that is renewed before it ages out. An older copy from before a renewal is still recognised.

## In Adobe Reader
Adobe shows each signature in the Signatures panel. Until the platform seal uses a publicly trusted certificate, Adobe may show "validity unknown"; the verification page is the authoritative check.`,
  },
  {
    slug: 'teams-and-approvals',
    title: 'Teams, departments and approvals',
    category: 'Teams & security',
    summary: 'Roles, departments, approval before sending and branding.',
    body: `## Roles
- **Owner** and **Admin**: manage settings, users, billing and see every agreement.
- **Member**: sends agreements and sees their own.

Invite people under **Settings → Team**.

## Departments
Group people under **Settings → Departments**. Agreements and templates can belong to a department; **managers** see all of the department's agreements, members see their own.

## Approval before sending
Under **Settings → Organization**, require approval for agreements sent by members (or by everyone). Approvers get an email and approve or send back with a note. Approving sends the agreement. If it is edited after approval, it needs approving again.

## Branding
Add your logo and colour under **Settings → Branding**; signers see them in emails and on the signing page.`,
  },
  {
    slug: 'security',
    title: 'Account security',
    category: 'Teams & security',
    summary: 'Two-factor authentication, single sign-on, IP allowlists and sessions.',
    body: `## Two-factor authentication
Turn it on under **Settings → Security** with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password). Save the recovery codes somewhere safe. Admins can require it for everyone under **Settings → Organization**.

## Passwords
Change your password under **Settings → Security**; other devices are signed out. Forgot it? Use **Forgot password?** on the sign-in page.

## Signed-in devices
See where you are signed in and sign out other devices.

## Single sign-on
On Enterprise, connect your identity provider (Okta, Microsoft Entra ID, Google) under **Settings → Single sign-on**, optionally with SCIM provisioning.

## IP allowlist
Admins can limit the app and API to office or VPN addresses under **Settings → Governance**. Signers are not restricted.`,
  },
  {
    slug: 'billing-and-plans',
    title: 'Plans, billing and invoices',
    category: 'Account',
    summary: 'Trial, plan limits, changing plans, GST invoices and cancelling.',
    body: `## Trial
Every account starts with 14 days of all features (25 agreements, 5 users). When it ends, sending stops until you choose a plan; existing agreements stay available.

## Plans
- **Starter**: up to 5 users, 25 agreements per user each month.
- **Business**: any number of users, 100 agreements per user each month, API, bulk send.
- **Enterprise**: unlimited, single sign-on and SCIM, custom terms. Talk to sales.

Choose or change your plan under **Settings → Billing**. Adding users or upgrading is charged pro rata for the rest of the period.

## Invoices
Every payment has a downloadable invoice. Indian customers are billed in rupees with GST; add your GSTIN under **Invoice details** to claim input tax credit.

## Cancelling
**Cancel subscription** keeps your plan until the end of the paid period. You can undo it until then.`,
  },
  {
    slug: 'api-and-webhooks',
    title: 'API, SDKs and webhooks',
    category: 'Developers',
    summary: 'Keys, test mode, the OpenAPI spec, SDKs, webhooks and embedded signing.',
    body: `## Keys
Create keys under **Settings → API & webhooks**. **Test keys** (\`dsk_test_\`) create watermarked agreements that aren't billed and work on every plan. **Live keys** (\`dsk_\`) need the Business plan or above.

## Reference
The API is described at \`/api/v1/openapi.json\`, with examples on the [Developers](/developers) page. Node.js and Python SDKs are available.

## Webhooks
Register an HTTPS endpoint for events such as \`envelope.completed\`. Each request carries \`X-DocSign-Signature: t=<unix>,v1=<hex>\`, an HMAC-SHA256 of \`t.body\` with your endpoint secret. Verify it before trusting the payload. Failed deliveries are retried with backoff.

## Embedded signing
Create recipients with \`embedded: true\` and call \`POST /envelopes/{id}/recipients/{rid}/embedded-session\` for a one-time URL to show in an iframe on a site you allow under **Settings → Organization**.

## AI assistants
An MCP server at \`/api/v1/mcp\` lets AI assistants look up, send, remind and void agreements with an API key.`,
  },
  {
    slug: 'integrations',
    title: 'Integrations',
    category: 'Developers',
    summary: 'Google Drive, Dropbox, OneDrive, Slack, Microsoft Teams, Zapier and CRMs.',
    body: `## Cloud storage
Import documents from Google Drive, Dropbox or OneDrive when preparing an agreement (if your administrator has enabled them), or paste a share link from any of them.

## Slack and Microsoft Teams
Under **Settings → Integrations**, paste a Slack incoming-webhook URL or a Teams Workflows webhook URL and choose which events to post (signed, declined, completed…).

## Zapier and Make
Use REST hooks to trigger zaps when agreements are sent or completed.

## CRMs
Connect HubSpot or Salesforce under **Settings → Integrations** to log agreement activity on contacts and attach signed PDFs.`,
  },
  {
    slug: 'data-retention-and-privacy',
    title: 'Data retention, legal hold and exports',
    category: 'Teams & security',
    summary: 'How long agreements are kept, deleting them, legal holds and exporting records.',
    body: `## Legal retention
Signed agreements are stored write-once for the retention period of their jurisdiction (for example 8 years in India). They cannot be deleted before then.

## Automatic deletion
Admins can delete completed agreements after a set number of days (never before the legal minimum) and unfinished ones (drafts, voided, declined, expired) after a shorter period, under **Settings → Governance**. Each deletion is recorded in the activity log with the document fingerprints.

## Legal hold
Place an agreement on **legal hold** from its page to stop it being deleted, for example during a dispute.

## Exports
Download an agreement's audit trail as CSV from its page, and the activity log or all agreement events as JSON lines under **Settings → Governance**.`,
  },
];

export const articleBySlug = (slug: string) => ARTICLES.find((a) => a.slug === slug) ?? null;
