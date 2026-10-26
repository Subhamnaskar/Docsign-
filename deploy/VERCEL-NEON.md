# Host on Vercel + Neon only (sign.nuronixai.in)

The whole app (website, API and background jobs) runs on **Vercel**. **Neon**
holds the database and, in its object storage bucket, the uploaded and signed
PDFs. Email goes through your **Hostinger** mailbox.

| Piece | Where |
|---|---|
| Website + API | Vercel (one project; the API is a serverless function) |
| Database | Neon Postgres (free: 0.5 GB) |
| Files | Neon object storage, bucket `documents` (free: 5 GB) |
| Background jobs (reminders, workflows, webhooks) | A scheduler calls the app every 5 minutes (step 6) |
| Email | Hostinger (`info@nuronixai.in`) |
| Address | `sign.nuronixai.in` (one DNS record at Hostinger) |

**Limits of this setup**

- **Uploads up to about 4 MB per file**: Vercel caps request size at 4.5 MB.
- **Word, Excel and PowerPoint** need step 7 (free, through your Google account); until then
  uploads are PDF only. No virus scanning.
- Signed files are not write-once storage: the bucket has no Object Lock, so
  the app itself refuses to delete them before their retention date.
- **Vercel Hobby (free) is for non-commercial use.** Fine for testing and demos;
  move to Vercel Pro before charging customers.

---

## 1. Neon: database

1. Sign up at **neon.tech** (GitHub login works) → create a project, region
   **AWS Asia Pacific (Singapore)**, with **Postgres** and **Object storage** on.
   Add one bucket: `documents`, **Private**.
2. Get the connection details. Either:
   - with the Neon CLI in the project folder: `npm i -g neon`, `neon init`
     (link the project, services postgres + object-storage), `neon deploy`.
     This writes them to `.env.local` (git-ignored); or
   - in the Neon console: **Connect** (pooling off) for the database, and the
     bucket's **Access keys** for storage.
3. `DATABASE_URL` for Vercel is the **unpooled** connection string with
   `&connection_limit=3` added at the end.

## 2. Hostinger: email mailboxes

**hPanel → Emails → nuronixai.in → Create email account**:
`info@nuronixai.in` (save its password). The app sends from it, and support and sales mail goes to it.

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
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT` | `AWS_ENDPOINT_URL_S3` from step 1 |
| `S3_REGION` | `ap-southeast-1` |
| `S3_ACCESS_KEY` | `AWS_ACCESS_KEY_ID` from step 1 |
| `S3_SECRET_KEY` | `AWS_SECRET_ACCESS_KEY` from step 1 |
| `S3_BUCKET` | `documents` |
| `S3_OBJECT_LOCK` | `false` |
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
| `SMTP_USER` | `info@nuronixai.in` |
| `SMTP_PASS` | the mailbox password |
| `MAIL_FROM` | `DocSign <info@nuronixai.in>` |
| `SALES_EMAIL` | `info@nuronixai.in` |
| `SUPPORT_EMAIL` | `info@nuronixai.in` |
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

## 7. Word, Excel and PowerPoint files (free, through Google)

Office files are turned into PDFs by Google Drive: each file is uploaded to your
Google account as a Google Doc, Sheet or Slides file, exported as PDF and deleted
straight away. The app only gets the `drive.file` permission, so it can never see
the rest of your Drive.

1. **console.cloud.google.com** → create a project (e.g. "Nuronix eSign").
2. **APIs & Services → Library** → search **Google Drive API** → **Enable**.
3. **Google Auth Platform → Branding**: app name `Nuronix eSign`, your support email.
   **Audience**: External, then **Publish app** (in "Testing" the connection stops
   working after 7 days).
4. **Clients → Create client** → type **Desktop app** → copy the client ID and secret.
5. On your PC, in the project folder:

   ```powershell
   npm run google:connect -w @docsign/api -- <client id> <client secret>
   ```

   Sign in with the Google account to use and allow access. If Google says the app
   isn't verified, choose **Advanced → Go to Nuronix eSign**. The terminal prints four lines.
6. Add those four lines in Vercel (Settings → Environment Variables), then
   **Deployments → ⋯ → Redeploy**.

The upload boxes on the website and in the app offer Word, Excel and PowerPoint as
soon as this is set up. To use your own converter instead, set `CONVERTER=gotenberg`
and `GOTENBERG_URL`.

## Updating

Push to GitHub; Vercel redeploys and applies database changes automatically.

## When you outgrow it

Without the bucket, `STORAGE_DRIVER=database` keeps files in Postgres instead
(no S3 settings needed). Bigger uploads, Word conversion and virus scanning
need a server: Render
(`render.yaml`, `deploy/FREE-NO-CARD.md`) or a VPS (`deploy/README.md`).
Change the `sign` DNS record to move; the app is the same.
