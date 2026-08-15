<p align="center">
  <img src="apps/frontend/public/brand/postsider-logo.png" alt="PostSider" width="80" height="80" />
</p>

<h1 align="center">PostSider</h1>

<p align="center">
  Open-source social media scheduling for 40+ platforms.<br />
  Plan, compose and publish from one calendar, with a public API, SDK and MCP server.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#self-hosting">Self-Hosting</a> &middot;
  <a href="#development">Development</a> &middot;
  <a href="#license">License</a>
</p>

## Features

**Scheduling and publishing**

- Visual calendar, day-aware posting queues, recurring content and Smart Slots.
- Per-platform previews and validation before publishing.
- Optional first comments for supported platforms.
- Connectors for X, LinkedIn, Facebook, Instagram, YouTube, TikTok, Bluesky,
  Mastodon, Discord, Slack, Telegram, Pinterest and more.

**Composer and collaboration**

- Hashtag groups, caption templates, UTM presets and reusable snippets.
- Bulk CSV import and approval workflows.
- Media library, team roles and multi-organization workspaces.
- Analytics where the social provider supports it.

**Automation**

- Public REST API and TypeScript SDK.
- Lean MCP server for compatible AI clients.
- Optional OpenAI caption checks and rewrites.
- Webhooks for publishing events.

## Quick Start

Requirements: Docker Engine with Compose v2, at least 6 GB free RAM and a
domain with HTTPS for a public deployment.

```bash
git clone https://github.com/lumizone/postsider.git
cd postsider
umask 077
cp .env.example .env
chmod 600 .env
# Edit .env: set your domain and replace every CHANGE_ME value.
docker compose up -d --build --wait
```

The application is bound to `127.0.0.1:5000`. Configure a TLS reverse proxy for
your domain, then create the first administrator:

```bash
docker compose exec postsider node apps/commands/dist/apps/commands/src/bootstrap.main.js bootstrap
```

Verify all application processes before using the instance:

```bash
curl -fsS http://127.0.0.1:5000/api/health
docker compose exec postsider wget -qO- http://127.0.0.1:3002/health/workers
```

See [the self-hosting guide](docs/SELF_HOSTING.md) for HTTPS, OAuth callbacks,
backups, upgrades and troubleshooting.

## Self-Hosting

The bundled Compose stack includes the app, PostgreSQL, Redis, MinIO and
Temporal. Billing is disabled by default, so self-hosted organizations are
unlimited. Configure only the OAuth credentials for platforms you use.

Read [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) before a public deployment.
It covers reverse proxies, HTTPS, storage, backups, upgrades and Temporal worker
health.

## Architecture

```text
apps/backend       NestJS API
apps/frontend      Next.js dashboard
apps/orchestrator  Temporal workers for scheduling and publishing
apps/commands      Bootstrap and operational CLI commands
apps/mcp           MCP server over the public API
apps/sdk           TypeScript SDK
libraries/         Shared Prisma, integrations and services
```

The same source supports self-hosting and managed deployments through
environment configuration. Leaving `POLAR_ACCESS_TOKEN` unset gives a
self-hosted instance unlimited plans. Leaving `OPENAI_API_KEY` unset disables
platform AI; organizations can optionally use their own key.

## Development

```bash
pnpm install
cp .env.example .env
# Apply the local process overrides after the required secret placeholders.
cat .env.local.example >> .env
pnpm run dev:docker
pnpm run prisma-migrate-deploy
pnpm run dev
# In another terminal:
pnpm run dev:frontend
```

Run the checks used by CI:

```bash
pnpm run check:public-release
pnpm run build:backend
pnpm run build:orchestrator
pnpm --filter ./apps/frontend run build
pnpm test
NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs
```

## Public API and MCP

The public API is served at `/public/v1`. It authenticates with the raw
organization API key in `Authorization`, without a `Bearer` prefix. Behind the
bundled application proxy, use `https://your-domain.example/api` as the MCP or
SDK base URL.

See [apps/mcp/README.md](apps/mcp/README.md) for MCP configuration and the
available tools.

## License

PostSider is licensed under the [GNU Affero General Public License v3.0](LICENSE).
If you modify PostSider and make it available over a network, AGPL-3.0 requires
you to offer that modified source to the users of that service.
