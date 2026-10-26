# Host DocSign free at sign.nuronixai.in

No credit card needed. About 30–40 minutes.

| Piece | Service | Free limit |
|---|---|---|
| App (website + API) | **Render** free web service | 512 MB RAM; sleeps after 15 min idle (kept awake in step 7) |
| Database | **Neon** | 0.5 GB |
| File storage | **Supabase Storage** | 1 GB |
| Email | **Hostinger email** you already have | your Hostinger plan's sending limit |
| Address + HTTPS | **sign.nuronixai.in** on your Hostinger DNS | free certificate from Render |
| Keep-awake ping | **cron-job.org** | free |

Your main site (nuronixai.in, app.nuronixai.in on Vercel) is not touched.

**Not on the free plan:** Word/Excel conversion (upload PDFs) and virus scanning,
which need more memory. Sealed files are not write-once (Supabase has no Object
Lock). Pages are slower than on a paid server. Fine for demos and first pilots.

---

## 1. Neon: database

1. Sign up at **neon.tech** (GitHub login works) → create a project, region
   **AWS Asia Pacific (Singapore)** (closest to India).
2. **Connect** → copy the connection string (starts with `postgresql://`, ends
   with `?sslmode=require`). This is `DATABASE_URL`.

## 2. Supabase: file storage

1. Sign up at **supabase.com** → **New project**, region **Mumbai (ap-south-1)**.
2. **Storage** → **New bucket** → name `docsign-documents`, keep it **private**.
3. **Storage → S3 Connection** (Settings): copy the **Endpoint** (`S3_ENDPOINT`)
   and **Region** (`S3_REGION`). Under **Access keys** → *New access key*: copy
   the **Access key ID** (`S3_ACCESS_KEY`) and **Secret** (`S3_SECRET_KEY`).

## 3. Hostinger: email mailboxes

In **hPanel → Emails → nuronixai.in → Create email account**:

- `no-reply@nuronixai.in`: the app sends from this. Save its password (`SMTP_PASS`).
- `support@nuronixai.in` and `sales@nuronixai.in`: shown on the website and in emails.

Your existing SPF record already allows Hostinger to send for nuronixai.in, so
nothing else is needed. (Optional, better delivery: in hPanel turn on **DKIM**
for the domain, and later change DMARC from `p=none` to `p=quarantine`.)

## 4. Seal key (on your PC)

Signed PDFs are sealed with a key. Free hosts wipe their disk on restart, so the
key is stored as a setting. In the project folder (PowerShell):

```powershell
$env:KEYS_DIR = '.keys-prod'; npm run keys:export -w @docsign/api
```

Copy the long line it prints: that's `SEAL_KEYS`. Keep it secret, and keep the
`.keys-prod` folder as a backup (git ignores it).

## 5. Render: the app

1. Sign up at **render.com** with GitHub and allow access to the `Docsign-` repository.
2. **New → Blueprint** → pick the repository. Render reads `render.yaml`
   (address, Hostinger email server and most settings are already filled in).
3. Fill in the values it asks for:
   - `DATABASE_URL` from step 1
   - `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` from step 2
   - `SMTP_PASS`: the `no-reply@nuronixai.in` mailbox password from step 3
   - `SEAL_KEYS` from step 4
   - `PLATFORM_ADMINS`: your email
4. **Apply**. The first build takes ~10 minutes. Note the service address,
   e.g. `docsign-xxxx.onrender.com`.

## 6. Hostinger DNS: point sign.nuronixai.in at Render

1. Render → your service → **Settings → Custom Domains → Add** → `sign.nuronixai.in`.
2. **hPanel → Domains → nuronixai.in → DNS / Nameservers → Add record**:
   - Type **CNAME**, Name **sign**, Target **docsign-xxxx.onrender.com** (your Render address), TTL default.
3. Back in Render, click **Verify**. The HTTPS certificate is issued
   automatically (a few minutes up to an hour).

Open **https://sign.nuronixai.in** and register with your `PLATFORM_ADMINS` email.

## 7. Keep it awake

Free Render services sleep after 15 minutes: then reminders and workflows pause
and the next visitor waits about a minute.

**cron-job.org** → sign up → **Create cronjob**: URL
`https://sign.nuronixai.in/api/v1/billing/plans`, every **10 minutes**.

---

## Updating

Push to GitHub; Render redeploys automatically.

## When you outgrow it

- Render **Starter** (~$7/month) removes sleeping and adds memory; then Word
  conversion and virus scanning can be turned on.
- Or move to one small VPS with `deploy/README.md` (same address, change the DNS record).
- Payments, SMS/WhatsApp, Aadhaar eSign and KYC stay in test mode until you add
  live provider keys (names in `apps/api/.env.example`).
