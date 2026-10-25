# Host DocSign free, without a credit card

Four free services, about 30 minutes:

| Piece | Service | Free limit |
|---|---|---|
| App (website + API) | **Render** free web service | 512 MB RAM; sleeps after 15 min idle (kept awake by step 5) |
| Database + file storage | **Supabase** free project | 500 MB database, 1 GB files |
| Email | **Brevo** | 300 emails/day |
| Keep-awake ping | **cron-job.org** | free |

**Good for:** demos, testing, first pilot customers.
**Not on the free plan:** Word/Excel upload conversion (upload PDFs) and virus
scanning, which need more memory. Sealed files are not write-once (Supabase has
no Object Lock). Pages are slower than on a real server.

---

## 1. Supabase: database and file storage

1. Sign up at **supabase.com** (GitHub login works) → **New project**. Region:
   **Mumbai (ap-south-1)**. Choose a database password and save it.
2. **Database:** click **Connect** (top) → **Session pooler** → copy the URI.
   Replace `[YOUR-PASSWORD]` with your password. This is `DATABASE_URL`.
3. **Files:** **Storage** → **New bucket** → name `docsign-documents`, keep it **private**.
4. **Storage → S3 Connection**: copy the **Endpoint** (`S3_ENDPOINT`) and
   **Region** (`S3_REGION`). Under **Access keys** → *New access key*: copy the
   **Access key ID** (`S3_ACCESS_KEY`) and **Secret** (`S3_SECRET_KEY`).

## 2. Brevo: email

1. Sign up at **brevo.com** → **Senders, Domains & Dedicated IPs** → add and
   verify your sender email.
2. **SMTP & API → SMTP**: copy the **Login** (`SMTP_USER`) and generate an
   **SMTP key** (`SMTP_PASS`).

## 3. Seal key (on your PC)

Signed PDFs are sealed with a key. Free hosts wipe their disk on restart, so the
key is stored as a setting. In the project folder (PowerShell):

```powershell
$env:KEYS_DIR = '.keys-prod'; npm run keys:export -w @docsign/api
```

Copy the long line it prints: that's `SEAL_KEYS`. Keep it secret, and keep the
`.keys-prod` folder as a backup (it's ignored by git).

## 4. Render: the app

1. Sign up at **render.com** with GitHub and allow access to the `Docsign-` repository.
2. **New → Blueprint** → pick the repository. Render reads `render.yaml`.
3. Fill in the values it asks for:
   - `APP_URL` and `CORS_ORIGINS`: `https://docsign.onrender.com` (use the service
     name Render shows; fix it after the first deploy if different)
   - `DATABASE_URL`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` from step 1
   - `SMTP_USER`, `SMTP_PASS` from step 2; `MAIL_FROM` like `DocSign <you@your-email.com>` (your verified sender)
   - `SEAL_KEYS` from step 3
   - `PLATFORM_ADMINS`: your email
4. **Apply**. The first build takes ~10 minutes. Then open the URL and register
   with your `PLATFORM_ADMINS` email.

## 5. Keep it awake

Free Render services sleep after 15 minutes, and then reminders and workflows
pause and the next visitor waits about a minute.

**cron-job.org** → sign up → **Create cronjob**: URL
`https://YOUR-SERVICE.onrender.com/api/v1/billing/plans`, every **10 minutes**.

This also keeps the Supabase project active (free projects pause after a week idle).

---

## Updating

Push to GitHub and Render redeploys automatically.

## When you outgrow it

- Render **Starter** ($7/month) removes sleeping and gives more memory, and then
  Word conversion and virus scanning can run (see `deploy/docker-compose.yml`).
- Or move everything to one small VPS with `deploy/README.md`.
- Payments, SMS/WhatsApp, Aadhaar eSign and KYC stay in sandbox mode until you
  add live provider keys (names in `apps/api/.env.example`).
