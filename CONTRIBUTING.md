# Contributing to PostSider

Thanks for contributing. Please open an issue before large changes so the work
does not overlap or diverge from the project direction.

## Local setup

```bash
pnpm install
cp .env.example .env
pnpm run dev:docker
pnpm run prisma-migrate-deploy
pnpm run dev
```

Run the frontend in a second terminal with `pnpm run dev:frontend`. Do not use
`prisma db push` for changes that will be committed. Create a Prisma migration
with `pnpm run prisma-migrate-dev` and commit its generated files.

## Before opening a pull request

```bash
pnpm run check:public-release
pnpm run build:backend
pnpm run build:orchestrator
pnpm --filter ./apps/frontend run build
pnpm test
NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs
```

- Keep each pull request focused.
- Add or update tests for behavior changes.
- Never commit `.env` files, API keys, database exports or customer data.
- Use conventional commit subjects such as `feat:`, `fix:` or `docs:`.
- For code reachable from `apps/orchestrator/src/workflows`, do not import Node
  modules such as `crypto` or `undici`; Temporal runs workflow code in a
  deterministic sandbox.

## Project structure

| Path | Purpose |
| --- | --- |
| `apps/backend` | NestJS REST API |
| `apps/frontend` | Next.js dashboard |
| `apps/orchestrator` | Temporal publishing workers |
| `apps/commands` | Bootstrap and CLI commands |
| `apps/mcp` | MCP server over the public API |
| `apps/sdk` | TypeScript SDK |
| `libraries` | Shared integrations, Prisma and services |

## Security reports

Do not disclose vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).
