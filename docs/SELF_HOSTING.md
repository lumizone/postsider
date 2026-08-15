# Self-Hosting PostSider

## Requirements

- Docker Engine and Docker Compose v2.
- At least 6 GB free RAM and 50 GB free disk.
- A domain and a reverse proxy that terminates HTTPS.
- OAuth applications registered for the social platforms you enable.

The default Compose stack binds only the application to `127.0.0.1:5000`.
PostgreSQL, Redis, MinIO and Temporal are private Docker services. The optional
Temporal UI starts with `docker compose --profile tools up -d` and is bound to
`127.0.0.1:8080`.

## First deployment

```bash
git clone https://github.com/lumizone/postsider.git
cd postsider
cp .env.example .env
```

Set your HTTPS domain in `FRONTEND_URL`, `BACKEND_URL`,
`NEXT_PUBLIC_BACKEND_URL` and `MINIO_PUBLIC_URL`. Replace every `CHANGE_ME`
value with a distinct random value. `NEXT_PUBLIC_*` settings are embedded in the
browser bundle, so changing them requires `docker compose up -d --build`.

Start the stack and wait for its health check:

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:5000/api/health
docker compose exec postsider wget -qO- http://127.0.0.1:3002/health/workers
```

Create the first administrator once:

```bash
docker compose exec postsider node apps/commands/dist/apps/commands/src/bootstrap.main.js bootstrap
```

## Reverse proxy

Serve your domain over HTTPS and proxy all paths to `127.0.0.1:5000`. MinIO
media is public by exact object URL so social platforms can fetch it. Proxy
`/storage/` to `127.0.0.1:9000/<your MINIO_BUCKET>/` and keep the MinIO console
private. A minimal nginx location layout is:

```nginx
server {
    listen 443 ssl http2;
    server_name social.example.com;
    client_max_body_size 512m;

    location /storage/ {
        proxy_pass http://127.0.0.1:9000/postsider-media/;
        proxy_set_header Host $host;
        add_header X-Content-Type-Options nosniff always;
    }

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Configure TLS certificates, HTTP to HTTPS redirects and host firewall rules in
your reverse proxy environment. Do not expose database, Redis, MinIO Console,
Temporal UI or Temporal gRPC ports to the Internet.

## OAuth and registration

For every platform you enable, create your own OAuth application and set its
credentials in `.env`. Register the callback
`https://your-domain.example/integrations/social/<provider>`. Set
`DISABLE_REGISTRATION=true` and `NEXT_PUBLIC_DISABLE_REGISTRATION=true` after
bootstrap if the instance is private.

## Updates and migrations

Back up before upgrading. Pull a tagged release or commit, then rebuild:

```bash
git pull --ff-only
docker compose up -d --build
docker compose ps
```

Prisma migrations run before the application processes start. Do not use
`prisma db push` on a production database. For databases created by an earlier
release, read the migration notes in the release you are upgrading to before
deploying.

## Backups

Back up both PostgreSQL and MinIO. A database backup alone does not include
uploaded media. Store encrypted copies off the host and test restoration.

```bash
docker compose exec -T postgres pg_dump -U postsider -Fc postsider > postsider.dump
```

For MinIO, use an S3-compatible backup tool or back up the `minio-data` Docker
volume. Keep the `.env` file with backups because `ENCRYPTION_KEY` is required
to decrypt stored provider credentials.

## Publishing health

Scheduling and publishing require Temporal workers. A healthy dashboard alone
does not prove that they are polling. Check both endpoints after deployment:

```bash
curl -fsS http://127.0.0.1:5000/api/health
docker compose exec postsider wget -qO- http://127.0.0.1:3002/health/workers
```

If scheduled posts remain in `QUEUE` past their publish time without an error,
inspect the `main` Temporal task queue and the orchestrator logs. Do not add
Node-only imports to Temporal workflow code: a broken workflow bundle can stop
workers while the frontend remains available.
