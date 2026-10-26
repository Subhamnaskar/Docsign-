# Host on Vercel + Neon only (sign.nuronixai.in)

The whole app (website, API, files and background jobs) runs on **Vercel**,
with **Neon** as the database. Files (uploaded and signed PDFs) are stored in
Neon too. Email goes through your **Hostinger** mailbox. No credit card.

| Piece | Where |
|---|---|
| Website + API | Vercel (one project; the API is a serverless function) |
| Database + files | Neon (free: 0.5 GB, enough for thousands of signed PDFs) |
| Background jobs (reminders, workflows, webhooks) | A scheduler calls the app every 5 minutes (step 6) |
| Email | Hostinger (`no-reply@nuronixai.in`) |
| Address | `sign.nuronixai.in` (one DNS record at Hostinger) |

**Limits of this setup**

- **Uploads up to about 4 MB per file**: Vercel caps request size at 4.5 MB.
- **PDF uploads only**: no Word/Excel conversion or virus scanning.
- Signed files are not write-once storage (the database keeps them; deleting
  them before their retention date is refused by the app).
- **Vercel Hobby (free) is for non-commercial use.** Fine for testing and demos;
  move to Vercel Pro before charging customers.

---

## 1. Neon: database

1. Sign up at **neon.tech** (GitHub login works) → create a project, region
   **AWS Asia Pacific (Singapore)**.
2. **Connect** → turn **Connection pooling off** → copy the connection string.
   Add `&connection_limit=3` at the end. This is `DATABASE_URL`, for example:
   `postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&connection_limit=3`

## 2. Hostinger: email mailboxes

**hPanel → Emails → nuronixai.in → Create email account**:
`no-reply@nuronixai.in` (save its password), plus `support@` and `sales@`.

## 3. Seal key (on your PC)

In the project folder (PowerShell):

```powershell
$env:KEYS_DIR = '.keys-prod'; npm run keys:export -w @docsign/api
```

Copy the long line it prints (`SEAL_KEYS`). Keep it secret; keep the
`.keys-prod` folder as a backup.

Also make a random secret for the scheduler (`CRON_SECRET`):

```powershell
-join ((48..57)+(97..102) | Get-Random -Count 40 | % {[char]$_})
```

## 4. Vercel: the app

1. **vercel.com** → **Add New → Project** → import the `Docsign-` repository.
2. **Root Directory:** `apps/web` (leave the build settings as they are;
   `apps/web/vercel.json` sets them).
3. **Environment Variables** (add each):

| Name | Value |
|---|---|
| `DATABASE_URL` | from step 1 |
| `STORAGE_DRIVER` | `database` |
| `KEYS_DIR` | `/tmp/keys` |
| `SEAL_KEYS` | from step 3 |
| `CRON_SECRET` | from step 3 |
| `APP_SECRET` | another long random string (same command as CRON_SECRET) |
| `APP_URL` | `https://sign.nuronixai.in` |
| `CORS_ORIGINS` | `https://sign.nuronixai.in` |
| `CELL_REGION` | `in` |
| `WORKER_MODE` | `off` |
| `SMTP_HOST` | `smtp.hostinger.com` |
| `SMTP_PORT` | `465` |
| `SMTP_SECURE` | `true` |
| `SMTP_USER` | `no-reply@nuronixai.in` |
| `SMTP_PASS` | the mailbox password |
| `MAIL_FROM` | `DocSign <no-reply@nuronixai.in>` |
| `SUPPORT_EMAIL` | `support@nuronixai.in` |
| `PLATFORM_ADMINS` | your email |
| `TSA_URL` | `http://timestamp.digicert.com` |

4. **Deploy.** The build also creates the database tables. It takes ~5 minutes.

## 5. Your address: sign.nuronixai.in

1. Vercel project → **Settings → Domains** → add `sign.nuronixai.in`. Vercel shows a CNAME target.
2. **hPanel → Domains → nuronixai.in → DNS** → add **CNAME**, name `sign`,
   target as shown by Vercel (usually `cname.vercel-dns.com`).
3. Wait until Vercel shows the domain as valid (HTTPS is automatic).

Your main site (nuronixai.in) is not affected.

## 6. Background jobs every 5 minutes

Vercel's free plan runs scheduled jobs only once a day (already set up in
`vercel.json`). For reminders, workflows and webhooks to run promptly:

**cron-job.org** → sign up → **Create cronjob**:
- URL: `https://sign.nuronixai.in/api/v1/internal/tick`
- Every **5 minutes**
- **Advanced → Headers**: `Authorization` = `Bearer YOUR_CRON_SECRET`

Open **https://sign.nuronixai.in** and register with your `PLATFORM_ADMINS` email.

---

## Updating

Push to GitHub; Vercel redeploys and applies database changes automatically.

## When you outgrow it

Bigger uploads, Word conversion and virus scanning need a server: Render
(`render.yaml`, `deploy/FREE-NO-CARD.md`) or a VPS (`deploy/README.md`).
Change the `sign` DNS record to move; the app is the same.
