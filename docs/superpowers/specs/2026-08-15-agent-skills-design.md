# PostSider agent skills — design

Date: 2026-08-15
Status: approved, ready for implementation plan

## Problem

PostSider already exposes an MCP server (`apps/mcp`, 17 `postsider_*` tools over
`/public/v1`) and a REST "Agent Bridge" (`/public/v1/connectors`,
`/public/v1/inbound/*`, scoped `agt_` agent tokens with capabilities, rate
limits, and HITL mode). Any generic MCP client can already connect, but there
is no packaged, provider-specific guidance that teaches an AI agent how to use
PostSider *well* — task order, common workflows, auth model, error handling —
in the native format each agent platform expects.

Separately, `docs_site/src/content/docs/cloud/mcp.mdx` describes a stale tool
set (16 tools, names like `integrationList`, `schedulePostTool`) that does not
match the current `apps/mcp/src/index.ts` (17 tools, `postsider_*` names).
This must not be used as a source for the new content; it's a pre-existing
bug to fix separately.

## Audience

End users of PostSider (cloud or self-hosted) who want to point their own AI
agent (Claude, Cursor, OpenCode, Gemini CLI, a GPT, or a self-hosted Hermes
model) at their PostSider organization and have it schedule posts, check
analytics, manage channels, etc. in natural language. Not aimed at PostSider
developers extending the platform itself.

## Source of truth for capability content

Everything in `core/` is derived from the actual, current code, not from the
stale `cloud/mcp.mdx`:

- `apps/mcp/src/index.ts` — the 17 `postsider_*` MCP tools (names, input
  schemas, descriptions already double as good documentation).
- `libraries/nestjs-libraries/src/integrations/connector.catalog.ts`,
  `.../inbound/inbound.registry.ts`, `.../inbound-subscription.repository.ts`
  — the Agent Bridge REST surface (connector catalog, OAuth-initiate,
  inbound pull/subscribe).
- `docs_site/src/content/docs/self-hosted/public-api/agent-bridge.mdx` — the
  agent token model (capabilities, rate limits, HITL, connector scoping).
  This page is accurate and becomes the basis for `core/auth.md`; it is not
  itself moved or duplicated, just referenced/summarized.

## Repos and layout

**New GitHub repo: `lumizone/postsider-agent-skills`** — source of truth,
versioned independently of `postsider_app` (an agent skill's shelf life
shouldn't be coupled to backend release cadence, and this is a natural
public-facing companion repo alongside the already-public `postsider`).

```
postsider-agent-skills/
  core/
    workflows.md        # tool-call order for common tasks: schedule a post,
                         # check analytics, manage channels, bulk/inbound
                         # import, approvals; error-handling patterns
    auth.md              # agent token vs org API key, capabilities, HITL,
                          # rate limits — recommends agent tokens as default
    tools-reference.md   # generated/synced from apps/mcp/src/index.ts:
                          # tool name, description, input schema
  providers/
    claude/SKILL.md               # Anthropic Skill format (claude.ai, Claude Code)
    cursor/.cursor-rules
    cursor/mcp.json
    opencode/AGENTS.md
    opencode/mcp.json
    gemini/mcp.json               # Gemini CLI (native MCP)
    openai/actions-openapi.yaml   # GPT Actions / Custom GPT
    hermes/tools.json             # OpenAI-compatible function-calling schema
    hermes/system-prompt.md       # for self-hosted models (Ollama/vLLM/OpenRouter)
  README.md              # provider picker, links to docs.postsider.com
  scripts/
    check-tools-sync.<ts|sh>   # diffs tools-reference.md against
                                # apps/mcp/src/index.ts (see below)
```

Each `providers/<name>/` is a **thin adapter**: connection/config specifics
plus a short pointer into `core/` for the actual task playbook. `core/` is
written once and is the only place workflow guidance is maintained.

## docs.postsider.com integration

New "AI Agents" section under `docs_site` (sibling of the existing
`cloud/mcp.mdx`), one page per provider, each embedding/linking the
corresponding file(s) from `postsider-agent-skills` rather than duplicating
their content by hand. `cloud/mcp.mdx` gets corrected (tool list fixed) and
cross-linked from the new section — fixing the stale-docs bug is in scope as
part of this work since the new content depends on getting it right anyway.

## Auth model recommendation

`core/auth.md` recommends **agent tokens (`agt_...`) over the org API key**
as the default credential for connecting an AI agent: scoped to specific
connectors, specific capabilities (`PUBLISH`/`ANALYTICS`/`SOURCE`), rate
limited, optionally HITL-gated (agent can only create drafts, a human
approves). The org API key is mentioned as the alternative for
full-access/legacy setups. This is a content/documentation decision — no new
backend feature is required, the agent token system already exists.

## Keeping `tools-reference.md` in sync

A script (`scripts/check-tools-sync`) parses `apps/mcp/src/index.ts` for
`server.registerTool(...)` calls (name + title + description) and diffs
against `core/tools-reference.md`. It runs in this new repo's CI against a
pinned/latest copy of `postsider_app`'s `apps/mcp/src/index.ts` (fetched or
vendored — decide exact mechanism in the implementation plan) and fails the
build on drift, so the tool list can't silently go stale the way
`cloud/mcp.mdx` did.

## Provider scope (MVP = all 6, one PR)

| Provider | Native format | MCP-native? |
|---|---|---|
| Claude (claude.ai / Claude Code) | Anthropic Skill (`SKILL.md`) | yes |
| Cursor | `.cursor/rules` + `mcp.json` | yes |
| OpenCode | `AGENTS.md` + `mcp.json` | yes |
| Gemini CLI | `mcp.json` | yes |
| OpenAI / ChatGPT | GPT Actions (OpenAPI) | no — REST via Agent Bridge |
| Hermes (self-hosted) | OpenAI-compatible function-calling JSON + system prompt | no — REST via Agent Bridge |

The three non-native providers (OpenAI, Hermes, and partially Gemini's
non-CLI surfaces) consume the Agent Bridge REST endpoints directly rather
than MCP, since they have no MCP client of their own in their most common
deployment shape.

## Out of scope

- Submitting to any provider's official marketplace/plugin directory
  (OpenAI GPT Store, Gemini Extensions marketplace, Cursor MCP directory).
  This design produces copy-paste-able skill packages only.
- Any backend/API changes — the Agent Bridge and MCP server already have the
  needed capability surface.
- Auto-generating provider adapters from a single template — each is
  hand-written for its provider's idioms, `check-tools-sync` only guards the
  factual tool list in `core/tools-reference.md`.
