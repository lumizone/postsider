# PostSider — Production Deployment (VPS)

This guide takes a fresh VPS to a running, HTTPS-secured PostSider instance.

**Target:** a single VPS with ~6 GB free RAM and ~50 GB disk, a domain you control,
and Docker installed. The full stack (app, Postgres, Redis, MinIO, Temporal,
Elasticsearch) runs via `docker-compose.production.yaml`. A host-level reverse
proxy terminates TLS and forwards to the app.

```
Internet ──443──> Caddy/nginx (host) ──> 127.0.0.1:5000 (app container nginx)
                                    └──> 127.0.0.1:9000 (MinIO, /storage/*)
```

---

## 1. Prerequisites

On the VPS:

```bash
# Docker + compose plugin
curl -fsSL https://get.docker.com | sh
docker compose version   # must print a version
```

DNS: create an **A record** `app.postsider.com → <VPS_PUBLIC_IP>` (use your domain).

---

## 2. Firewall

Expose only SSH and web. The app, database and admin UIs stay bound to
`127.0.0.1` and are never reachable from the internet directly.

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## 3. Configure environment

Copy the template and fill it in. **Never reuse the development `.env`** — it
contains weak/dev secrets and `NOT_SECURED=true`.

```bash
cp .env.production.example .env.production
# Edit .env.production: set your domain + OAuth keys. Leave the CHANGE_ME
# secrets — deploy.sh generates strong random values for them automatically.
```

Set at minimum:

| Variable | Value |
|----------|-------|
| `FRONTEND_URL`, `BACKEND_URL` | `https://app.postsider.com` |
| `NEXT_PUBLIC_BACKEND_URL` | `https://app.postsider.com/api` |
| `NOT_SECURED` | **must stay `"false"`** |
| `DISABLE_REGISTRATION` | `true` for a private instance |
| `API_LIMIT` | `60`–`120` |

Secrets — leave them as `CHANGE_ME...` and `deploy.sh` will generate strong
random values automatically, **or** set them yourself:

```bash
openssl rand -base64 64   # JWT_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -hex 24      # POSTGRES_PASSWORD
openssl rand -hex 32      # MINIO_SECRET_KEY / DBGATE_PASSWORD
```

> `ENCRYPTION_KEY` is required in production. Without it, stored provider
> secrets fall back to the weaker legacy AES-256-CBC scheme derived from
> `JWT_SECRET`.

Add the OAuth credentials for the social platforms you actually use (X,
LinkedIn, Facebook, …). Use **fresh production credentials**, not the dev keys.

---

## 4. Deploy

```bash
./deploy.sh --bootstrap
```

This will:

1. Fill any remaining `CHANGE_ME` secrets (a timestamped backup is kept).
2. Build the image with `NEXT_PUBLIC_*` baked in.
3. Start the full stack and wait until the app is healthy.
4. Create the first admin user (`--bootstrap`) — note the one-time password it prints.

Re-deploys / updates:

```bash
git pull
./deploy.sh            # rebuild + restart (migrations run automatically on boot)
./deploy.sh --no-build # just restart
```

First login: sign in with `admin@setup.local` and the one-time password from
the bootstrap step, then set your real email and password.

---

## 5. Reverse proxy + HTTPS (on the host)

Pick one. Both forward `/` to the app and `/storage/*` to MinIO.

### Option A — Caddy (automatic HTTPS, recommended)

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile      # set your domain + email
sudo systemctl reload caddy
```

### Option B — nginx + certbot

```bash
sudo apt install nginx certbot python3-certbot-nginx
sudo cp deploy/nginx-host.conf /etc/nginx/sites-available/postsider
sudo ln -s /etc/nginx/sites-available/postsider /etc/nginx/sites-enabled/
sudo nano /etc/nginx/sites-available/postsider   # set your domain
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d app.postsider.com
```

Open `https://app.postsider.com` — you should reach the dashboard.

---

## 6. Admin UIs (optional, keep them private)

DbGate (`127.0.0.1:8082`) and Temporal UI (`127.0.0.1:8080`) are bound to
localhost only. Access them over an SSH tunnel:

```bash
ssh -L 8080:127.0.0.1:8080 -L 8082:127.0.0.1:8082 user@your-vps
```

Only expose them publicly behind basic auth (see the commented blocks in
`deploy/Caddyfile`). The MinIO console (`:9001`) can be removed from the compose
`ports` list in production.

---

## 7. Backups

Critical state lives in the Postgres and MinIO volumes.

```bash
# Database
docker exec postsider-postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-$(date +%F).sql

# Media (MinIO volume)
docker run --rm -v postsider_app_minio-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/minio-$(date +%F).tar.gz -C /data .
```

Automate with cron and store backups off-box.

---

## 8. Pre-flight security checklist

- [ ] `NOT_SECURED="false"` in `.env.production`
- [ ] `JWT_SECRET` and `ENCRYPTION_KEY` are random (not the dev defaults)
- [ ] Strong `POSTGRES_PASSWORD`, `MINIO_SECRET_KEY`, `DBGATE_PASSWORD`
- [ ] `DISABLE_REGISTRATION=true` (unless you want open sign-up)
- [ ] `API_LIMIT` set to a sane production value (60–120)
- [ ] Firewall allows only 22/80/443
- [ ] HTTPS works and HTTP redirects to it
- [ ] DbGate / Temporal UI not publicly exposed (or behind auth)
- [ ] Production OAuth keys in use — dev keys from `.env` rotated/removed
- [ ] Backups scheduled

---

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Dashboard loads but every API call fails / hits `localhost:3000` | `NEXT_PUBLIC_BACKEND_URL` wasn't set at build time. Set it in `.env.production` and rebuild with `./deploy.sh`. |
| 502 from the reverse proxy | App container not healthy yet — `docker compose --env-file .env.production -f docker-compose.production.yaml logs -f postsider`. |
| Scheduled posts never publish | Orchestrator/Temporal issue — check `postsider-temporal` and the orchestrator process inside the app container (`docker exec postsider-app pm2 ls`). |
| Login works locally but not in prod | `NOT_SECURED` must be `"false"` so the auth cookie is set as secure/httpOnly. |
| Images don't load (`/storage/...` 404) | Reverse proxy `/storage` → MinIO mapping missing, or the `postsider-media` bucket wasn't created. |
