<p align="center">
  <img src="apps/frontend/public/brand/postsider-logo.png" alt="PostSider" width="80" height="80" />
</p>

<h1 align="center">PostSider</h1>

<p align="center">
  Open-source publishing & communication bridge for AI agents.<br/>
  Give Claude Code, Codex and other agents a standard surface (MCP / REST / SDK) to
  publish across 40+ platforms — with a full scheduling dashboard for humans too.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#self-hosting">Self-Hosting</a> •
  <a href="#contributing">Contributing</a> •
  <a href="#license">License</a>
</p>

---

## Features

**Agent Bridge (primary surface)**

- **MCP server** — expose publishing, scheduling, analytics and channel management to AI agents (Claude Code, Codex, and compatible runtimes)
- **Public REST API + SDK** — versioned `/public/v1` API and the `@postsider/sdk` package for programmatic and agent-driven automation
- **40+ connectors** — X, LinkedIn, Facebook, Instagram, YouTube, TikTok, Threads, Bluesky, Mastodon, Reddit, Discord, Slack, Telegram, Pinterest, and many more
- **Webhooks** — notify external systems and agents when posts are published

**Scheduler UI (secondary, human-facing surface)**

- **Visual calendar** — drag-and-drop scheduling with time slot management
- **AI assistant** — generate, refine, and split posts using OpenAI (optional)
- **Team collaboration** — invite members with role-based access (Admin / User)
- **Multi-organization** — separate workspaces per brand or client
- **Media library** — upload, manage, and attach images/videos to posts
- **Analytics** — per-post performance tracking (where supported by provider)
- **Auto-post** — RSS-to-social automation
- **Self-hostable** — run on your own infrastructure with Docker

---

## Quick Start

### Prerequisites

- **Node.js** >= 20.17 (recommended: use [Volta](https://volta.sh/) — it auto-picks the right version)
- **pnpm** >= 10.6
- **PostgreSQL** >= 15
- **Redis** >= 7
- **Docker** (optional, for the all-in-one setup)

### Option A: Docker Compose (recommended)

```bash
git clone https://github.com/your-org/postsider.git
cd postsider
docker compose up -d
```

Open `http://localhost:4007` in your browser. On first launch, create your admin account through the bootstrap flow.

### Option B: Local development

```bash
# 1. Clone and install
git clone https://github.com/your-org/postsider.git
cd postsider
pnpm install

# 2. Set up environment
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL, REDIS_URL, JWT_SECRET

# 3. Push database schema
pnpm prisma-db-push

# 4. Create your first admin user
pnpm bootstrap

# 5. Start development servers (backend + orchestrator)
pnpm dev

# 6. In another terminal — start frontend
pnpm dev:frontend
```

The backend runs on `http://localhost:3000`, frontend on `http://localhost:4200`.

### First login

After running `pnpm bootstrap`, you'll receive a one-time password in the terminal. Sign in with `admin@setup.local` and that password — you'll be prompted to set your real email and password.

---

## Architecture

PostSider is a **pnpm monorepo** with the following structure:

```
postsider/
├── apps/
│   ├── backend/          # NestJS REST API (auth, posts, integrations, billing)
│   ├── orchestrator/     # Temporal worker (scheduled publishing, token refresh)
│   ├── frontend/         # Next.js 15 dashboard (React 19, App Router)
│   ├── commands/         # CLI utilities (bootstrap, config)
│   └── sdk/              # Published npm package for the public API
├── libraries/
│   ├── nestjs-libraries/ # Shared backend logic (Prisma, integrations, AI, uploads)
│   └── helpers/          # Lightweight utilities (auth, crypto, validation)
├── docker-compose.yaml   # Production-ready stack
└── .env.example          # Configuration reference
```

### Tech stack

| Layer | Technology |
|-------|-----------|
| Backend API | NestJS 11, TypeScript 5.5 |
| Frontend | Next.js 15, React 19, CSS Modules |
| Database | PostgreSQL 17 + Prisma 6.5 |
| Cache / Queue | Redis 7 |
| Workflow Engine | Temporal (durable post scheduling, token refresh) |
| AI | OpenAI, LangGraph, Mastra, CopilotKit |
| Storage | Local filesystem or Cloudflare R2 |
| Auth | JWT + bcrypt, OAuth (GitHub, Google, Generic OIDC) |
| Monitoring | Sentry |

### Key design decisions

- **Temporal for scheduling** — posts are scheduled as durable workflows, surviving restarts and crashes. Token refresh runs on a cron workflow.
- **Per-provider integration classes** — each social platform is a self-contained class implementing `SocialProvider`. Adding a new platform = adding one file.
- **CASL-based permissions** — subscription tier determines what actions are allowed. Guards check abilities on every request.
- **Public API with SDK** — the `@postsider/sdk` package wraps the public v1 endpoints for external consumers.

---

## Configuration

All configuration lives in environment variables. See [`.env.example`](.env.example) for the full reference.

### Required variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Random string for signing tokens (make it long and unique) |
| `FRONTEND_URL` | Public URL where the dashboard is accessible |
| `NEXT_PUBLIC_BACKEND_URL` | Public URL of the backend API |

### Storage

By default, files are stored locally in `./uploads/`. For cloud storage, set:

```env
STORAGE_PROVIDER=cloudflare
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_ACCESS_KEY=...
CLOUDFLARE_SECRET_ACCESS_KEY=...
CLOUDFLARE_BUCKETNAME=...
CLOUDFLARE_BUCKET_URL=...
```

### Social platform API keys

Each platform requires its own OAuth credentials. Refer to `.env.example` for the full list. You only need to configure the platforms you plan to use.

---

## Self-Hosting

### Docker Compose (production)

The included `docker-compose.yaml` runs the full stack:

- **PostSider** app (backend + frontend in one container)
- **PostgreSQL 17** (app database)
- **Redis 7** (caching + rate limiting)
- **Temporal** (workflow engine + its own Postgres + Elasticsearch)
- **Temporal UI** (workflow monitoring, port 8080)

```bash
# Generate a secure JWT secret
export JWT_SECRET=$(openssl rand -base64 32)

# Start everything
docker compose up -d

# Check logs
docker compose logs -f postsider
```

### Updating

```bash
docker compose pull
docker compose up -d
```

### Backups

The critical data lives in PostgreSQL. Back up the `postsider-postgres` volume regularly:

```bash
docker exec postsider-postgres pg_dump -U postsider-user postsider-db-local > backup.sql
```

---

## Development

### Useful commands

```bash
# Run backend only
pnpm dev:backend

# Run frontend only
pnpm dev:frontend

# Run orchestrator only
pnpm dev:orchestrator

# Generate Prisma client after schema changes
pnpm prisma-generate

# Push schema changes to database
pnpm prisma-db-push

# Reset database (destructive!)
pnpm prisma-reset

# Build all apps
pnpm build

# Build SDK
pnpm build:sdk
```

### Project conventions

- **Path aliases** — `@postsider/backend/*`, `@postsider/helpers/*`, `@postsider/nestjs-libraries/*`, etc.
- **Global DatabaseModule** — all Prisma repositories and services are provided globally via `DatabaseModule`
- **Integration pattern** — each social provider extends `SocialAbstract` and implements `SocialProvider`
- **Temporal workflows** — defined in `apps/orchestrator/src/workflows/`

---

## Public API

PostSider exposes a public REST API for programmatic access. Authenticate with your org's API key via the `Authorization` header.

### SDK

```bash
npm install @postsider/sdk
```

```typescript
import Postsider from '@postsider/sdk';

const client = new Postsider('your-api-key', 'https://your-instance.com');

// Create a post
await client.post({
  type: 'schedule',
  date: '2025-01-15T10:00:00',
  posts: [{ integration: { id: 'channel-id' }, value: [{ content: 'Hello!' }] }],
});

// List posts
const posts = await client.postList({ page: 0, limit: 20 });

// List connected channels
const channels = await client.integrations();
```

---

## Contributing

Contributions are welcome! Here's how to get started:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Ensure TypeScript compiles: `npx tsc --noEmit --project apps/backend/tsconfig.json`
5. Commit with a clear message
6. Open a Pull Request

### What we're looking for

- Bug fixes with clear reproduction steps
- New social platform integrations
- Documentation improvements
- Performance optimizations
- Test coverage (we're actively building this out)

### Code style

- TypeScript strict mode (excluding `strictNullChecks` for now — PRs to fix null-safety are welcome)
- Prettier for formatting (`.prettierrc` in root)
- ESLint for linting (`.eslintignore` in root)

---

## Roadmap

- [ ] Test coverage for core flows (auth, posts, integrations)
- [ ] Enable `strictNullChecks` across the codebase
- [ ] GitHub Actions CI (lint + typecheck + build)
- [ ] Mobile app (React Native)
- [ ] Plugin system for custom integrations
- [ ] Bulk scheduling / CSV import
- [ ] Advanced analytics dashboard

---

## License

PostSider is licensed under the [GNU Affero General Public License v3.0](LICENSE).

This means you can use, modify, and distribute PostSider freely — but if you run a modified version as a network service, you must make your source code available to users of that service.
