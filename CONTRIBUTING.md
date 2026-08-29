# Contributing to PostSider

Thanks for your interest in contributing! This guide will help you get set up and understand our workflow.

## Getting started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally
3. **Install dependencies**: `pnpm install`
4. **Set up your environment**: `cp .env.example .env` and fill in `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`
5. **Push the database schema**: `pnpm prisma-db-push`
6. **Bootstrap admin**: `pnpm bootstrap`
7. **Start dev servers**: `pnpm dev` (backend + orchestrator) and `pnpm dev:frontend` (frontend)

## Development workflow

```bash
# Create a branch
git checkout -b fix/my-bugfix

# Make changes...

# Verify TypeScript compiles
npx tsc --noEmit --project apps/backend/tsconfig.json
npx tsc --noEmit --project apps/frontend/tsconfig.json

# Format code
pnpm prettier --write .

# Commit
git commit -m "fix: description of the change"

# Push and open a PR
git push origin fix/my-bugfix
```

## Commit conventions

We use conventional commit messages:

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `perf:` — performance improvement
- `chore:` — build process, dependency updates, etc.

Examples:
```
feat: add Rumble integration
fix: prevent crash when user has no organizations
docs: add self-hosting section to README
refactor: extract token refresh logic into dedicated service
```

## Project structure

| Path | Description |
|------|-------------|
| `apps/backend/` | NestJS REST API |
| `apps/frontend/` | Next.js dashboard |
| `apps/orchestrator/` | Temporal workflow workers |
| `apps/commands/` | CLI tools (bootstrap, migrations) |
| `apps/sdk/` | Public npm SDK |
| `libraries/nestjs-libraries/` | Shared backend (Prisma, integrations, services) |
| `libraries/helpers/` | Lightweight utilities |

## Adding a new social integration

1. Create a new file in `libraries/nestjs-libraries/src/integrations/social/`
2. Extend `SocialAbstract` and implement `SocialProvider`
3. Register it in `libraries/nestjs-libraries/src/integrations/integration.manager.ts` (add to `socialIntegrationList`)
4. Add the provider icon to `apps/frontend/platforms/`
5. Add the label mapping to `apps/frontend/src/lib/integrations.ts`

Look at `bluesky.provider.ts` or `telegram.provider.ts` for simpler examples.

## Code style

- **Language**: TypeScript (strict mode, excluding `strictNullChecks` for now)
- **Formatting**: Prettier (config in `.prettierrc`)
- **Linting**: ESLint (config follows `@typescript-eslint`)
- **Naming**: camelCase for variables/functions, PascalCase for classes/types, kebab-case for file names
- **Imports**: Use path aliases (`@postsider/backend/*`, `@postsider/nestjs-libraries/*`, etc.)

## What makes a good PR

- **Focused** — one logical change per PR
- **Compiles** — `tsc --noEmit` passes on all relevant projects
- **Described** — explain what changed, why, and how to test it
- **Small** — easier to review = faster to merge

## Areas where help is especially welcome

- **Tests** — we have zero test coverage currently. Unit tests for services, integration tests for API endpoints
- **Null safety** — fixing `strictNullChecks` violations (run `npx tsc --noEmit --strictNullChecks --project apps/backend/tsconfig.json` to see the list)
- **Documentation** — improving setup guides, API docs, integration guides
- **New platforms** — adding support for more social networks
- **Accessibility** — improving the frontend dashboard for screen readers

## Questions?

Open a Discussion on GitHub or reach out in the issues. We're happy to help you get oriented in the codebase.
