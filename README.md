# PostSider

Open-source social media scheduling for teams and agencies. Plan, compose and
publish content for 40+ platforms from one calendar, with approvals, a public
API, SDK and optional MCP server.

[Self-hosting](docs/SELF_HOSTING.md) | [Contributing](CONTRIBUTING.md) | [Security](SECURITY.md) | [AGPL-3.0](LICENSE)

## Features

- Calendar scheduling, posting queues, recurring content and Smart Slots.
- Per-platform previews, validation and first comments.
- Approvals, team roles and multi-organization workspaces.
- Media library, CSV import, caption templates, hashtag groups and UTM presets.
- Public REST API, TypeScript SDK and MCP server for compatible AI clients.
- Optional OpenAI caption checks and rewrites.
- Self-hosted PostgreSQL, Redis, MinIO and Temporal stack.

## Quick Start

Requirements: Docker Engine with Compose v2, at least 6 GB free RAM and a
domain with HTTPS for a public deployment.

```bash
git clone https://github.com/lumizone/postsider.git
cd postsider
cp .env.example .env
# Edit .env: set your domain and replace every CHANGE_ME value.
docker compose up -d --build
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
