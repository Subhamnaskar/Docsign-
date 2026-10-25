# Host DocSign for free

Everything (website, app, API, database, file storage, document conversion)
runs on **one free server** with Docker. HTTPS is automatic.

| Piece | Free service | Limit |
|---|---|---|
| Server | **Oracle Cloud Always Free**, Ampere A1 VM | 4 CPU, 24 GB RAM, 200 GB disk, free forever |
| Web address | **DuckDNS** (`yourname.duckdns.org`) or your own domain | free subdomain |
| HTTPS | Caddy + Let's Encrypt (included) | free, renews itself |
| Email | **Brevo** SMTP | 300 emails/day |

Oracle asks for a debit/credit card to verify you (₹0 charged on Always Free).
If you don't want that, see "Other free options" at the end.

---

## 1. Create the free server (Oracle Cloud)

1. Sign up at **cloud.oracle.com** → *Start for free*. Pick a home region close
   to you (e.g. **India West (Mumbai)** or **India South (Hyderabad)**); it can't
   be changed later.
2. Menu → **Compute → Instances → Create instance**.
   - **Image:** Canonical **Ubuntu 24.04**.
   - **Shape:** *Change shape* → **Ampere** → `VM.Standard.A1.Flex`, **4 OCPU, 24 GB** (shows "Always Free-eligible").
     If it says *out of capacity*, try 2 OCPU / 12 GB, or try again later.
   - **SSH keys:** *Generate a key pair* and **download the private key**.
3. Create, wait until it's *Running*, and copy its **Public IP address**.
4. Open the web ports: instance → **Subnet** → **Default Security List** →
   *Add Ingress Rules*: source `0.0.0.0/0`, TCP, destination ports **80,443**.

## 2. Point a web address at it

**Free (DuckDNS):** sign in at **duckdns.org**, add a subdomain (e.g. `nuronixsign`),
put the server's public IP in *current ip*, *update ip*.
Your address is `nuronixsign.duckdns.org`.

**Your own domain:** add a DNS **A record** (e.g. `sign` → the public IP).

## 3. Free email (Brevo)

1. Sign up at **brevo.com** → **Senders, Domains & Dedicated IPs** → add and verify the sender email.
2. **SMTP & API → SMTP**: note the **login** and create an **SMTP key** (the password).

## 4. Install Docker on the server

From your PC (PowerShell), connect with the downloaded key:

```powershell
ssh -i C:\path\to\ssh-key.key ubuntu@YOUR_PUBLIC_IP
```

On the server:

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu && newgrp docker
# Ubuntu on Oracle blocks web ports in its own firewall too: open them
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 5. Get the code and configure it

```bash
git clone https://github.com/Subhamnaskar/Docsign-.git docsign
cd docsign/deploy
cp .env.example .env
for v in APP_SECRET POSTGRES_PASSWORD S3_SECRET_KEY; do sed -i "s|^$v=.*|$v=$(openssl rand -hex 32)|" .env; done
nano .env
```

In `nano`, fill in: `DOMAIN` (e.g. `nuronixsign.duckdns.org`), the Brevo
`SMTP_USER` / `SMTP_PASS`, `MAIL_FROM` (your verified sender) and
`PLATFORM_ADMINS` (your email). Save with **Ctrl+O, Enter, Ctrl+X**.

## 6. Start it

```bash
docker compose up -d --build
```

The first build takes 5–10 minutes. Then open **https://YOUR_DOMAIN**.
Register with the email you put in `PLATFORM_ADMINS` to get the platform console.

Check on it with `docker compose ps` and `docker compose logs -f api`.

---

## Everyday tasks

**Update to the latest code** (after pushing to GitHub):
```bash
cd ~/docsign && git pull && cd deploy && docker compose up -d --build
```

**Back up the database** (run daily with `crontab -e`):
```bash
docker compose exec -T postgres pg_dump -U docsign docsign | gzip > ~/backup-$(date +%F).sql.gz
```
Also keep a copy of the `keys` volume: it holds the key that seals signed PDFs.

**Turn on virus scanning** (uses ~1.5 GB RAM): set `CLAMAV_HOST=clamav` in `.env`, then
```bash
docker compose --profile scan up -d
```

---

## Before real customers

- **Payments, SMS/WhatsApp, Aadhaar eSign, KYC, e-NACH, e-stamp** run in sandbox mode
  until you add each provider's live keys in `.env` (names in `apps/api/.env.example`).
- Signed PDFs are sealed with a self-made certificate: Adobe shows "validity unknown"
  until you buy an AATL document-signing certificate.
- Free tiers have limits (Brevo 300 emails/day). Move to paid plans as you grow.

## Other free options (no card)

These work but with trade-offs; the single Oracle server above is simpler and more capable.

| Piece | Service | Catch |
|---|---|---|
| Website/app | Vercel Hobby | Free plan is for non-commercial use |
| API | Render free web service (Docker) | Sleeps after 15 minutes idle (first request ~1 minute), 512 MB RAM: no virus scanning or Word conversion |
| Database | Neon or Supabase | 0.5 GB; Supabase pauses after a week idle |
| File storage | Cloudflare R2 | 10 GB free, needs a card for R2 |
| Email | Brevo | 300/day |
