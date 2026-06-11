# Requirements Document

_Język dokumentu: polski. Treść jest w języku polskim, jednak tytuły wymagań i nagłówki sekcji pozostają w języku angielskim zgodnie z wymogami formatu Kiro spec, a słowa kluczowe EARS (WHEN, WHILE, WHERE, IF, THEN, THE, SHALL) pozostają w języku angielskim zgodnie z normą EARS._

## Introduction

Repozytorium jest forkiem `postiz-app` (dawniej `gitroomhq/postiz-app`) i zawiera liczne pozostałości po projekcie źródłowym: nazwa głównego pakietu (`gitroom`), aliasy ścieżek TypeScript (`@gitroom/*`), dokumentacja (`README.md`, `SECURITY.md`, `ICLA.md`, `CCLA.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `.github/copilot-instructions.md`, `CLAUDE.md`), pliki CI/CD, konfiguracja, asety oraz prawdopodobnie zmienne środowiskowe i nazwy w schemacie bazy danych. Dodatkowo niektóre dokumenty są wewnętrznie sprzeczne (np. `copilot-instructions.md` mówi o monorepo NX, podczas gdy faktycznie jest to pnpm workspaces; `CLAUDE.md` opisuje frontend jako Vite ReactJS, a zależności i konfiguracja wskazują na Next.js 16).

Ten dokument opisuje wymagania dla dwóch równoległych nurtów prac:

- **Nurt A — Higiena kodu (rebranding):** Mechaniczne i semantyczne usunięcie pozostałości po projektach `gitroom`/`gitroomhq`/`postiz` z całego repozytorium oraz uspójnienie sprzecznej dokumentacji.
- **Nurt B — Repozycjonowanie produktu:** Przekształcenie PostSider z narzędzia do harmonogramowania postów w **most publikacyjny i komunikacyjny dla agentów AI** (Claude Code, Codex, Hermes, OpenClaw i podobne). Most ma udostępniać agentom AI w sposób ustandaryzowany dostęp do kanałów społecznościowych, społeczności (Reddit, Discord, Skool) oraz e-mail marketingu (Gmail, Mailgun, Resend, SMTP), zarówno w trybie publikacji wychodzącej, jak i pozyskiwania treści przychodzących.

Istniejący interfejs harmonogramowania, kalendarz, analityka i zarządzanie zespołem pozostają, ale stają się komponentem drugorzędnym (UI administracyjne) względem powierzchni dla agentów (MCP / REST / SDK).

## Glossary

- **PostSider_System**: Cała aplikacja jako produkt — backend, orchestrator, frontend, rozszerzenie przeglądarki, SDK i CLI.
- **Codebase**: Drzewo plików źródłowych w monorepo (`apps/*`, `libraries/*`, dokumenty główne, konfiguracja CI/CD).
- **Legacy_Identifier**: Dowolny ciąg znaków odnoszący się do pierwotnych projektów źródłowych: `gitroom`, `gitroomhq`, `Gitroom`, `postiz`, `Postiz`, `@gitroom/`, `@postiz/`, `GITROOM_`, `POSTIZ_` i pochodne.
- **Canonical_Identifier**: Zatwierdzona docelowa nazwa, która zastępuje `Legacy_Identifier` (np. `postsider`, `@postsider/`, `POSTSIDER_`, `PostSiderHQ`).
- **Path_Alias**: Alias ścieżki TypeScript zdefiniowany w `tsconfig*.json` (obecnie wzorzec `@gitroom/*`, docelowo `@postsider/*`).
- **Documentation**: Wszystkie pliki Markdown w korzeniu repozytorium oraz w `.github/` (`README.md`, `SECURITY.md`, `ICLA.md`, `CCLA.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CLAUDE.md`, `copilot-instructions.md`, szablony PR/issue).
- **Build_System**: Skrypty `build`, `dev`, `lint`, `test` w `package.json` na poziomie root oraz w pakietach `apps/*`.
- **Verification_Suite**: Łączny przebieg `pnpm install`, `pnpm run build`, `pnpm run test` i lintera, traktowany jako pojedyncza bramka jakości.
- **Allowlist_File**: Plik, w którym dopuszczalne jest pozostawienie `Legacy_Identifier` z powodów historycznych lub licencyjnych (np. `LICENSE`, `CHANGELOG.md`, plik notatek migracyjnych).
- **Agent_Bridge**: Powierzchnia integracyjna PostSider udostępniana agentom AI — obejmuje serwer MCP, publiczne API REST oraz SDK.
- **MCP_Server**: Serwer Model Context Protocol w obrębie `PostSider_System`, oparty o `@modelcontextprotocol/sdk` i `@mastra/mcp`, eksponujący narzędzia (tools) dla agentów AI.
- **REST_API**: Publiczne, wersjonowane API HTTP (OpenAPI) udostępniane pod prefiksem `/public/v1` i przeznaczone do wywołań z poziomu agentów lub integracji zewnętrznych.
- **Agent_SDK**: Pakiet `@postsider/node` (oraz potencjalnie inne języki), który udostępnia typowane wywołania `REST_API` i `MCP_Server`.
- **Connector**: Pojedyncza integracja z zewnętrzną platformą lub usługą (np. X, LinkedIn, Reddit, Discord, Skool, Gmail, Mailgun, Resend, SMTP). Każdy `Connector` deklaruje zbiór `Capability`.
- **Capability**: Boolowska zdolność konektora; w wersji v1 zdefiniowane są: `PUBLISH` (publikacja wychodząca), `SOURCE` (pozyskiwanie treści przychodzących), `ANALYTICS` (odczyt metryk), `SCHEDULE` (planowanie publikacji w przyszłości).
- **Connector_Catalog**: Rejestr wszystkich `Connector` z metadanymi (identyfikator, etykieta, ikona, deklarowane `Capability`, wymagane scope'y OAuth).
- **Inbound_Source**: `Connector` z aktywną `Capability` `SOURCE`, dostarczający zdarzenia przychodzące (np. nowy e-mail, wiadomość Discord, post Reddit).
- **Outbound_Channel**: `Connector` z aktywną `Capability` `PUBLISH`, do którego można publikować treści.
- **Agent_Token**: Token uwierzytelniający agenta AI, scope'owany do (organizacja, lista konektorów, lista capability), z opcjonalnymi limitami i terminem ważności.
- **Auth_Service**: Komponent odpowiedzialny za wystawianie, weryfikację i unieważnianie `Agent_Token`.
- **Audit_Log**: Trwały, niezmienny zapis każdej operacji wykonanej z użyciem `Agent_Token` (kto, co, kiedy, na jakim konektorze, z jakim wynikiem).
- **Audit_Logger**: Komponent zapisujący wpisy do `Audit_Log`.
- **HITL_Mode** (Human-in-the-Loop): Tryb organizacji, w którym akcje wykonane przez `Agent_Token` wymagają zatwierdzenia przez człowieka przed faktyczną publikacją.
- **Rate_Limiter**: Komponent egzekwujący limity wywołań na `Agent_Token` (per minuta, per dzień, per konektor).
- **Webhook_Dispatcher**: Komponent dostarczający zdarzenia z `Inbound_Source` do zewnętrznych odbiorców (agentów) z podpisem HMAC.
- **Scheduler_UI**: Istniejący frontend z kalendarzem, kompozytorem postów i analityką.
- **Observability_System**: Połączenie Sentry oraz śladów workflow Temporal używane do telemetrii i diagnostyki.
- **Migration_Tool**: Skrypt lub procedura zapewniająca kompatybilność wsteczną podczas zmiany nazw zmiennych środowiskowych, identyfikatorów w bazie danych lub aliasów ścieżek.

## Requirements

### Requirement 1: [A1] Rename root package and workspace package names

**User Story:** Jako maintainer projektu, chcę aby pole `name` w głównym `package.json` oraz w pakietach workspaces było zgodne z nazwą produktu, aby uniknąć mylenia repozytorium z projektem `gitroom`.

#### Acceptance Criteria

1. THE PostSider_System SHALL declare the root `package.json` `name` field as the `Canonical_Identifier` for the product.
2. WHEN `pnpm install` is executed at the repository root, THE Build_System SHALL complete without referencing any `Legacy_Identifier` in workspace package names.
3. THE PostSider_System SHALL update every `package.json` file in `apps/*` and `libraries/*` whose `name` field contains a `Legacy_Identifier` so that the field uses the `Canonical_Identifier` namespace instead.

### Requirement 2: [A2] Update TypeScript path aliases

**User Story:** Jako developer, chcę aby aliasy importów odzwierciedlały nazwę produktu, aby kod był spójny i nowi członkowie zespołu nie byli wprowadzani w błąd.

#### Acceptance Criteria

1. THE PostSider_System SHALL replace every `Path_Alias` matching the pattern `@gitroom/*` with the equivalent `Canonical_Identifier` alias in every `tsconfig.json`, `tsconfig.*.json`, `jest.config.*`, `vite.config.*`, `vitest.config.*`, ESLint configuration and Prettier configuration file in the `Codebase`.
2. THE PostSider_System SHALL replace every TypeScript `import` or `require` statement that uses a `Legacy_Identifier` `Path_Alias` with the equivalent `Canonical_Identifier` `Path_Alias`.
3. WHERE the migration plan permits a transitional period, THE PostSider_System SHALL keep the legacy `@gitroom/*` `Path_Alias` as a deprecated alias resolving to the same target, AND THE PostSider_System SHALL emit a single deprecation warning per process startup.
4. WHEN the transitional period ends, THE PostSider_System SHALL remove the deprecated legacy `Path_Alias` from every configuration file.
5. IF an import statement matching the pattern `@gitroom/*` is reintroduced after migration completion, THEN THE Verification_Suite SHALL fail with an error message identifying the offending file.

### Requirement 3: [A3] SDK package consistency

**User Story:** Jako konsument SDK, chcę aby pakiet `@postsider/node` importował wyłącznie z `Canonical_Identifier`, aby publikowany artefakt nie zawierał odwołań do nieistniejącego pakietu `@gitroom/*`.

#### Acceptance Criteria

1. THE PostSider_System SHALL ensure that every TypeScript file under `apps/sdk/src` imports only from `Canonical_Identifier` paths or from external npm packages.
2. WHEN the SDK is built, THE Build_System SHALL produce an artifact whose package metadata, type definitions and bundled JavaScript contain no `Legacy_Identifier`.
3. IF the SDK build artifact contains a `Legacy_Identifier`, THEN THE Verification_Suite SHALL fail with a list of offending symbols.

### Requirement 4: [A4] Update project documentation

**User Story:** Jako współtwórca, chcę aby dokumentacja konsekwentnie używała nazwy `PostSider`, aby nowi kontrybutorzy mieli jasny obraz, czym jest projekt.

#### Acceptance Criteria

1. THE PostSider_System SHALL update `README.md`, `SECURITY.md`, `ICLA.md`, `CCLA.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `.github/copilot-instructions.md`, `CLAUDE.md`, `.github/PULL_REQUEST_TEMPLATE.md` and every file under `.github/ISSUE_TEMPLATE/` so that no `Legacy_Identifier` referring to the source project remains.
2. THE Documentation SHALL reference the `Canonical_Identifier` GitHub organization, repository URL and npm scope consistently across every Markdown file.
3. WHEN a Markdown file references support, sponsorship or community channels, THE Documentation SHALL link to the channels owned by the `Canonical_Identifier` organization rather than to channels owned by the source project.

### Requirement 5: [A5] Reconcile contradictory documentation

**User Story:** Jako developer dołączający do projektu, chcę aby dokumentacja zgadzała się z faktycznym stanem repozytorium, abym nie tracił czasu na weryfikację rozbieżności.

#### Acceptance Criteria

1. THE Documentation SHALL describe the monorepo as `pnpm workspaces` rather than as an `NX monorepo`.
2. THE Documentation SHALL describe the frontend stack consistently across `README.md`, `CLAUDE.md` and `.github/copilot-instructions.md`, matching the actual stack present in `apps/frontend/package.json` and the build configuration files in `apps/frontend`.
3. THE Documentation SHALL describe the product positioning as `Agent_Bridge` (per Requirements 12 through 19) rather than as a standalone scheduling tool, while preserving the `Scheduler_UI` as a documented secondary feature.
4. IF a documentation statement contradicts the runtime configuration of the `Codebase`, THEN THE PostSider_System SHALL update the documentation to match the runtime configuration.

### Requirement 6: [A6] Audit and migrate environment variables

**User Story:** Jako operator instancji produkcyjnej, chcę móc zaktualizować nazwy zmiennych środowiskowych w sposób kontrolowany, aby istniejące wdrożenia nie przestały działać po wgraniu nowej wersji.

#### Acceptance Criteria

1. THE PostSider_System SHALL identify every environment variable in `.env.example`, `docker-compose*.yaml`, `Dockerfile.dev`, `railway.toml`, GitHub Actions workflow files and the application code, whose name begins with a `Legacy_Identifier` prefix such as `GITROOM_` or `POSTIZ_`.
2. THE PostSider_System SHALL define a single `Canonical_Identifier` prefix for environment variables and update the documentation and `.env.example` so that those files use only the new names.
3. WHEN the application reads a configuration value during startup, THE Migration_Tool SHALL first read the variable using the `Canonical_Identifier` name, and IF the canonical name is unset THEN THE Migration_Tool SHALL read the legacy name and emit a structured deprecation warning identifying the variable.
4. WHEN a deprecation warning is emitted for a legacy environment variable, THE Observability_System SHALL record the event so that operators can plan migration.
5. THE Documentation SHALL include a migration guide listing every renamed environment variable with old name, new name and the release in which the legacy fallback will be removed.

### Requirement 7: [A7] Audit CI/CD and Docker images

**User Story:** Jako inżynier release engineering, chcę aby pliki CI/CD odwoływały się wyłącznie do `Canonical_Identifier`, aby pipeline budowy publikował artefakty pod właściwą nazwą i registry.

#### Acceptance Criteria

1. THE PostSider_System SHALL update every file under `.github/workflows/` so that container image names, registry paths, action references and repository slugs use the `Canonical_Identifier`.
2. THE PostSider_System SHALL update `Jenkins/Build.Jenkinsfile`, `Jenkins/BuildPR.Jenkinsfile`, `railway.toml`, `sonar-project.properties`, `docker-compose*.yaml` and `Dockerfile.dev` so that no `Legacy_Identifier` remains.
3. WHEN a CI workflow tags or pushes a Docker image, THE Build_System SHALL use a tag derived from the `Canonical_Identifier`.
4. IF a CI configuration file references a `Legacy_Identifier` after the migration is complete, THEN THE Verification_Suite SHALL fail.

### Requirement 8: [A8] Audit database schema

**User Story:** Jako developer pracujący z danymi, chcę aby tabele i kolumny nie zawierały odwołań do projektu źródłowego, aby uniknąć semantycznego niedopasowania między modelem a produktem.

#### Acceptance Criteria

1. THE PostSider_System SHALL audit `libraries/nestjs-libraries/src/database/prisma/schema.prisma` for table names, column names, enum values, default values and comments containing any `Legacy_Identifier`.
2. WHERE a database identifier contains a `Legacy_Identifier` and renaming is technically safe, THE PostSider_System SHALL rename the identifier in the Prisma schema and provide a Prisma migration that performs the rename without data loss.
3. WHERE a database identifier contains a `Legacy_Identifier` but renaming would break existing data or external integrations, THE PostSider_System SHALL document the rationale for keeping the legacy name in a migration notes section of `Documentation`.
4. IF a Prisma migration introduced as part of this rebrand fails on a test database populated with representative data, THEN THE Verification_Suite SHALL fail.

### Requirement 9: [A9] Audit i18n and assets

**User Story:** Jako użytkownik końcowy, chcę aby interfejs i asety (logo, ikony, klucze tłumaczeń) odzwierciedlały markę PostSider, aby produkt sprawiał wrażenie spójnego.

#### Acceptance Criteria

1. THE PostSider_System SHALL audit every JSON translation file matching `i18n/*.json`, `locales/*.json` or `*.i18n.json` for `Legacy_Identifier` occurrences in values (excluding keys) and replace them with `Canonical_Identifier`.
2. THE PostSider_System SHALL rename or replace every asset file under `.github/assets/`, `apps/frontend/public/` and other asset directories whose file name contains a `Legacy_Identifier`.
3. WHEN a frontend route path contains a `Legacy_Identifier`, THE PostSider_System SHALL rename the route and add a redirect from the legacy path for at least one release cycle.
4. WHERE a translation key contains a `Legacy_Identifier`, THE PostSider_System SHALL rename the key and update every reference in the frontend code.

### Requirement 10: [A10] License attribution

**User Story:** Jako maintainer projektu open source, chcę aby plik `LICENSE` i atrybucja były zgodne z aktualnym stanem prawnym forka, aby zachować zgodność z AGPL-3.0 i licencjami pochodnymi.

#### Acceptance Criteria

1. WHERE the upstream project requires preservation of original copyright notices under AGPL-3.0, THE PostSider_System SHALL retain the original notice in `LICENSE` and add an additional notice identifying the `Canonical_Identifier` fork.
2. THE Documentation SHALL include an `ATTRIBUTION.md` file or an equivalent section in `README.md` that lists every relevant source project from which the code originates, including `postiz-app`, together with the corresponding license.
3. IF a file in `Allowlist_File` retains a `Legacy_Identifier` for legal or historical reasons, THEN THE Verification_Suite SHALL exempt that file from the rebrand grep check.

### Requirement 11: [A11] Rebrand verification gate

**User Story:** Jako maintainer, chcę mieć automatyczną bramkę CI, która wykrywa wprowadzenie pozostałości legacy w przyszłych zmianach, aby uniknąć regresji.

#### Acceptance Criteria

1. WHEN the rebrand is declared complete, THE Verification_Suite SHALL include a step that runs a case-insensitive search for the patterns `gitroom`, `gitroomhq` and `postiz` in source, configuration and documentation files outside `Allowlist_File`, and THE Verification_Suite SHALL fail if any match is found.
2. WHEN `pnpm install`, `pnpm run build`, `pnpm run lint` and `pnpm run test` are executed against the rebranded `Codebase`, THE Build_System SHALL succeed without errors related to the rebrand.
3. THE PostSider_System SHALL document the `Allowlist_File` set explicitly, listing every file allowed to retain `Legacy_Identifier` in a file such as `.rebrand-allowlist`.
4. IF a developer adds a new file outside the `Allowlist_File` set containing a `Legacy_Identifier`, THEN THE Verification_Suite SHALL fail in CI before the change can be merged.

### Requirement 12: [B1] Stable agent-facing integration surface

**User Story:** Jako agent AI (np. Claude Code, Codex), chcę mieć stabilny, ustandaryzowany interfejs do PostSider, aby publikować treści i pozyskiwać zdarzenia bez konieczności rozumienia wewnętrznych warstw aplikacji.

#### Acceptance Criteria

1. THE Agent_Bridge SHALL expose three coherent surfaces: `MCP_Server`, `REST_API` versioned under `/public/v1`, and `Agent_SDK`.
2. THE REST_API SHALL publish an OpenAPI specification that documents every endpoint exposed to agents, including request models, response models and error codes.
3. THE MCP_Server SHALL register a tool for each operation defined in Requirement 14, with a JSON schema describing the tool inputs and outputs.
4. THE Agent_SDK SHALL provide typed wrappers for every endpoint of `REST_API` and for every tool of `MCP_Server`.
5. WHEN the `REST_API` introduces a backwards-incompatible change, THE Agent_Bridge SHALL increment the API version path segment and keep the previous version available for at least one release cycle.

### Requirement 13: [B2] Connector abstraction and catalog

**User Story:** Jako agent AI, chcę móc odpytać `PostSider_System` o listę dostępnych konektorów i ich możliwości, aby dynamicznie dopasować plan działania do dostępnych integracji.

#### Acceptance Criteria

1. THE PostSider_System SHALL implement a `Connector` abstraction that defines a stable identifier, a human-readable label, an icon URL, a list of supported `Capability` values and the OAuth scopes required for each capability.
2. THE Connector_Catalog SHALL include every existing integration (X, LinkedIn, Instagram, Facebook, Threads, Bluesky, Mastodon, TikTok, YouTube, Pinterest, Dribbble, Slack, Discord, Telegram, Reddit, Farcaster, Nostr, Skool) and every email integration (Resend, Mailgun, Gmail, SMTP via Nodemailer).
3. THE PostSider_System SHALL declare for each `Connector` whether the connector supports `PUBLISH`, `SOURCE`, `ANALYTICS` and `SCHEDULE`, with at least one of these capabilities being true.
4. WHEN an agent calls the `listConnectors` operation, THE Agent_Bridge SHALL return the entries of the `Connector_Catalog` filtered to the connectors the calling organization has authorized.
5. IF a `Connector` declares the `SOURCE` capability, THEN THE PostSider_System SHALL provide a corresponding `Inbound_Source` implementation capable of producing events.
6. IF a `Connector` declares the `PUBLISH` capability, THEN THE PostSider_System SHALL provide a corresponding `Outbound_Channel` implementation capable of accepting a publish request.

### Requirement 14: [B3] Operations exposed to agents

**User Story:** Jako agent AI, chcę mieć dobrze zdefiniowany zestaw operacji (publikuj, harmonogramuj, analizuj, subskrybuj, pobierz źródło), aby implementować przepływy automatyzacji bez improwizacji.

#### Acceptance Criteria

1. WHEN an agent calls `listConnectors`, THE Agent_Bridge SHALL return a JSON array of `Connector` definitions, each containing the connector identifier, label, supported `Capability` flags and authorization status for the calling organization.
2. WHEN an agent calls `authorizeConnector` with a connector identifier, THE Agent_Bridge SHALL return either an OAuth authorization URL to be presented to a human, or a confirmation that the connector is already authorized.
3. WHEN an agent calls `publishPost` with a payload referencing one or more authorized `Outbound_Channel` and a content body, THE Agent_Bridge SHALL enqueue the publication and return a publication identifier.
4. WHEN an agent calls `schedulePost` with a payload identical to `publishPost` plus a future timestamp, THE Agent_Bridge SHALL enqueue the publication for execution at that timestamp and return a scheduled publication identifier.
5. WHEN an agent calls `getAnalytics` with a publication identifier or a connector identifier and a time range, THE Agent_Bridge SHALL return analytics metrics aggregated from the corresponding `Connector`, or an explicit error code when analytics are not supported by that connector.
6. WHEN an agent calls `subscribeToInboundEvents` with a list of `Inbound_Source` identifiers and a webhook URL, THE Webhook_Dispatcher SHALL deliver every matching event to that webhook URL with an HMAC signature.
7. WHEN an agent calls `fetchSourceContent` with an `Inbound_Source` identifier and an optional cursor, THE Agent_Bridge SHALL return a paginated list of source items (e-mails, Reddit threads, Discord messages, Skool posts).
8. IF an agent calls an operation on a `Connector` that the calling organization has not authorized, THEN THE Agent_Bridge SHALL return an error with code `connector_not_authorized` and emit an `Audit_Log` entry.
9. IF an agent calls `publishPost` with a payload exceeding a connector-specific length, attachment count or media size limit, THEN THE Agent_Bridge SHALL return a structured validation error and not enqueue the publication.
10. WHEN an agent calls `publishPost` with an idempotency key already used within the configured deduplication window, THE Agent_Bridge SHALL return the previously created publication identifier without enqueuing a duplicate publication.

### Requirement 15: [B4] Agent authentication and authorization model

**User Story:** Jako administrator organizacji, chcę precyzyjnie kontrolować, jakie operacje może wykonywać agent AI w moim imieniu, aby ograniczyć ryzyko i mieć pełen ślad audytowy.

#### Acceptance Criteria

1. THE Auth_Service SHALL issue an `Agent_Token` scoped to a single organization, a list of allowed `Connector` identifiers, a list of allowed `Capability` values and an optional expiration timestamp.
2. WHEN an agent calls any `Agent_Bridge` operation with an `Agent_Token`, THE Auth_Service SHALL verify the token signature, expiration and scope before allowing the operation to proceed.
3. THE Audit_Logger SHALL persist an `Audit_Log` entry for every agent operation containing the token identifier, the operation name, the input parameter hashes, the resulting status and a high-resolution timestamp.
4. WHERE an organization has enabled `HITL_Mode`, THE Agent_Bridge SHALL hold every `publishPost` and `schedulePost` request in a pending state and require explicit human approval through the `Scheduler_UI` before the publication is dispatched to the `Outbound_Channel`.
5. IF an `Agent_Token` is revoked, THEN THE Auth_Service SHALL reject every subsequent operation using that token and emit an `Audit_Log` entry for each rejection.
6. THE PostSider_System SHALL exclude every raw third-party provider token (OAuth access token, refresh token, app password) from every response returned to an agent through `Agent_Bridge`.

### Requirement 16: [B5] Rate limits and quotas

**User Story:** Jako operator instancji produkcyjnej, chcę chronić platformę i konektory przed nadużyciem przez błędnie zaprogramowanego agenta lub złośliwego klienta, ustalając limity wywołań.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL enforce a per-`Agent_Token` request rate limit configurable per minute and per day.
2. THE Rate_Limiter SHALL enforce a per-`Connector` publication quota configurable per `Agent_Token` per day.
3. WHEN an agent exceeds a configured rate limit, THE Agent_Bridge SHALL return HTTP status 429 with a `Retry-After` header and emit an `Audit_Log` entry of type `rate_limited`.
4. WHEN a `Connector` provider returns its own rate-limit error, THE Agent_Bridge SHALL surface a structured error to the agent containing a hint about the provider-imposed limit and a retry policy.

### Requirement 17: [B6] Backwards compatibility with existing UI

**User Story:** Jako istniejący użytkownik produktu PostSider, chcę aby kalendarz, kompozytor postów i analityka działały dalej bez zmian, aby nowa powierzchnia agenta nie zepsuła moich obecnych przepływów.

#### Acceptance Criteria

1. THE Scheduler_UI SHALL continue to provide every existing feature (calendar, post composer, analytics, team management, media library) without functional regression after the introduction of `Agent_Bridge`.
2. WHEN a publication is created through `Scheduler_UI`, THE PostSider_System SHALL store the publication in the same data model as a publication created through `Agent_Bridge` so that both surfaces share consistent state.
3. WHEN a publication is created through `Agent_Bridge`, THE Scheduler_UI SHALL display the publication on the calendar with a marker identifying the `Agent_Token` that created it.
4. WHERE a connector configuration exists prior to the introduction of `Agent_Bridge`, THE PostSider_System SHALL automatically expose that configuration to `Agent_Bridge` operations without requiring a re-authorization step.

### Requirement 18: [B7] Observability of agent actions

**User Story:** Jako inżynier on-call, chcę mieć pełny ślad telemetryczny operacji agentów, aby diagnozować incydenty bez przeszukiwania bazy danych ręcznie.

#### Acceptance Criteria

1. WHEN an agent operation begins, THE Observability_System SHALL emit a structured log entry containing the operation name, the `Agent_Token` identifier, the organization identifier and a correlation identifier.
2. WHEN an agent operation enqueues a Temporal workflow, THE Observability_System SHALL propagate the correlation identifier into the workflow run and into every activity invocation.
3. IF an agent operation fails, THEN THE Observability_System SHALL emit a Sentry event with the correlation identifier, the redacted input parameters and the exception stack.
4. THE Observability_System SHALL allow an operator to retrieve every log entry for a single correlation identifier across `Agent_Bridge`, the orchestrator and any `Connector` worker.

### Requirement 19: [B8] Connector and webhook security

**User Story:** Jako specjalista ds. bezpieczeństwa, chcę aby tokeny dostawców zewnętrznych były szyfrowane w spoczynku, a webhooki podpisane, aby zminimalizować skutki ewentualnego wycieku.

#### Acceptance Criteria

1. THE PostSider_System SHALL store every third-party provider credential (OAuth access token, refresh token, API key, app password) encrypted at rest using a key managed outside the application database.
2. WHEN the `Webhook_Dispatcher` delivers an inbound event, THE Webhook_Dispatcher SHALL include an HMAC signature header derived from a per-subscription secret and the request body.
3. WHEN an agent receives a webhook, THE Agent_SDK SHALL provide a helper function that verifies the HMAC signature against the per-subscription secret.
4. IF a webhook delivery fails, THEN THE Webhook_Dispatcher SHALL retry with exponential backoff up to a configurable maximum and record each attempt in the `Audit_Log`.
5. IF a third-party provider revokes a stored credential, THEN THE PostSider_System SHALL mark the corresponding `Connector` as `unauthorized` for that organization and emit an `Audit_Log` entry of type `connector_revoked`.

### Requirement 20: [NF1] Performance

**User Story:** Jako agent AI integrujący się z PostSider, chcę aby kluczowe operacje powierzchni Agent_Bridge zwracały odpowiedź w przewidywalnym czasie, aby moje przepływy nie blokowały się na sieci.

#### Acceptance Criteria

1. WHEN an agent calls `listConnectors`, THE Agent_Bridge SHALL return a response within 500 milliseconds at the 95th percentile under nominal production load.
2. WHEN an agent calls `publishPost` with a single-channel payload smaller than 4 kilobytes, THE Agent_Bridge SHALL acknowledge the request within 800 milliseconds at the 95th percentile, deferring actual publication to a background worker.
3. WHEN the `Webhook_Dispatcher` delivers an inbound event, THE Webhook_Dispatcher SHALL achieve a delivery latency from event reception to first delivery attempt below 5 seconds at the 95th percentile.

### Requirement 21: [NF2] Security

**User Story:** Jako specjalista ds. bezpieczeństwa, chcę aby system konsekwentnie chronił tokeny i sekrety, aby ich wyciek z logów lub błędów był niemożliwy.

#### Acceptance Criteria

1. THE Auth_Service SHALL hash `Agent_Token` values at rest using a one-way function so that the token plaintext is not recoverable from the database.
2. THE PostSider_System SHALL redact every `Agent_Token` value and every third-party provider credential from logs, error messages and telemetry.
3. WHEN a security-relevant configuration value is missing (encryption key, JWT secret, signing secret), THE PostSider_System SHALL refuse to start and emit a startup error identifying the missing value.

### Requirement 22: [NF3] Migration and compatibility

**User Story:** Jako operator, chcę aby zmiany rebrandu i wprowadzenie Agent_Bridge nie wymagały jednoczesnej zmiany konfiguracji wdrożeń, aby aktualizacja była bezpieczna.

#### Acceptance Criteria

1. THE Documentation SHALL include a single migration guide covering every breaking change introduced by the rebrand and by `Agent_Bridge`, with a target release for each item.
2. THE PostSider_System SHALL support an existing production deployment upgrading to the rebranded version without changing environment variable names in the same release in which they are renamed, by relying on the dual-read fallback defined in Requirement 6.
3. WHEN a deprecated environment variable is read, THE Observability_System SHALL emit a deprecation warning at most once per process lifetime.

### Requirement 23: [NF4] System observability

**User Story:** Jako inżynier obserwowalności, chcę mieć dashboardy i query, które pokażą stan integracji i operacji agentów w czasie rzeczywistym, aby diagnoza incydentów była szybka.

#### Acceptance Criteria

1. THE Observability_System SHALL provide dashboards or saved queries showing per-`Connector` success rate, latency and error rate.
2. WHEN an `Audit_Log` entry is written, THE Observability_System SHALL make the entry queryable by organization identifier, `Agent_Token` identifier, `Connector` identifier and time range.

## Out of Scope

- Tworzenie nowych integracji z platformami społecznościowymi, które nie są jeszcze obecne w `Connector_Catalog` — każda nowa platforma będzie osobną specyfikacją.
- Implementacja samych runtime'ów agentów AI (Claude Code, Codex, Hermes, OpenClaw) — `PostSider_System` udostępnia jedynie powierzchnię, z której te runtime'y korzystają.
- Przeprojektowanie wizualne `Scheduler_UI`. UI pozostaje funkcjonalnie nienaruszone i otrzymuje jedynie minimalne dodatki (np. znacznik publikacji utworzonych przez agenta).
- Zmiany w modelu cenowym, planach subskrypcji ani integracji ze Stripe.
- Migracja kodu z Next.js na Vite (lub odwrotnie) jako część tego specu — Nurt A obejmuje wyłącznie uspójnienie dokumentacji ze stanem faktycznym.
- Internacjonalizacja interfejsu dla nowych języków poza tymi obecnie wspieranymi.
- Implementacja własnej skrzynki odbiorczej dla e-maili (PostSider odbiera e-mail jako `Inbound_Source`, ale nie zastępuje klienta pocztowego użytkownika).

## Correctness Properties (testable invariants)

Lista testowalnych właściwości, które po zakończeniu prac muszą być utrzymywane przez automatyczne testy (jednostkowe, integracyjne lub property-based). Każda właściwość jest powiązana z jednym lub wieloma wymaganiami powyżej.

1. **Brak importów z legacy aliasów (invariant; powiązane z Wymaganiem 2 i 11).** Dla każdego pliku TypeScript w `apps/*/src/**` i `libraries/*/src/**` żaden import nie pasuje do wzorca `^@gitroom/`. Test: skaner AST w CI.
2. **Brak `Legacy_Identifier` poza allowlistą (invariant; Wymagania 1, 4, 7, 11).** Dla każdego pliku w `Codebase` poza `Allowlist_File` wynik `grep -i -E '(gitroom|gitroomhq|postiz)'` jest pusty.
3. **Każdy `Connector` ma co najmniej jedną aktywną `Capability` (invariant; Wymaganie 13).** Dla każdego elementu `Connector_Catalog` co najmniej jedna z flag `PUBLISH`, `SOURCE`, `ANALYTICS`, `SCHEDULE` jest `true`.
4. **Każdy `Connector` z `SOURCE = true` ma rejestrowaną implementację `Inbound_Source` (invariant; Wymaganie 13).** Test: enumeracja katalogu i sprawdzenie obecności klasy/handlera.
5. **Każda akcja agenta jest audytowalna (invariant; Wymagania 15 i 18).** Dla każdej operacji `Agent_Bridge` istnieje co najmniej jeden wpis `Audit_Log` powiązany przez identyfikator korelacji. Test property-based: wygenerować zbiór losowych operacji i sprawdzić bijection między operacjami a wpisami audytu.
6. **Idempotencja publikacji (idempotence; Wymaganie 14).** Dla każdego losowego payloadu publikacji P i klucza idempotencji K, dwukrotne wywołanie `publishPost(P, K)` zwraca ten sam identyfikator publikacji i tworzy dokładnie jedną publikację. Test property-based.
7. **Round-trip serializacji `Agent_Token` (round-trip; Wymaganie 15).** Dla każdego losowego scope'u tokenu (organizacja, konektory, capability, expiration), serializacja → deserializacja zwraca scope semantycznie równy oryginałowi. Test property-based.
8. **Konfluencja autoryzacji (confluence; Wymaganie 15).** Dla każdego `Agent_Token` końcowy werdykt nie zależy od kolejności sprawdzeń `signature`, `expiration` i `scope`. Test property-based.
9. **Walidacja webhooka HMAC (round-trip + error conditions; Wymaganie 19).** Dla losowego ciała żądania B i sekretu S zachodzą jednocześnie `verify(sign(B, S), B, S) == true` oraz `verify(sign(B, S), B', S) == false` dla `B' != B`. Test property-based.
10. **Migracja zmiennych środowiskowych preferuje `Canonical_Identifier` (invariant; Wymaganie 6).** Dla każdej zmiennej, której obie wersje (legacy i canonical) są ustawione, aplikacja używa wartości spod nazwy `Canonical_Identifier`. Test property-based na kombinacjach (canonical_set, legacy_set).
11. **Spójność `package.json` workspaces (invariant; Wymaganie 1).** Pole `name` w `package.json` w korzeniu i w każdym pakiecie workspaces nie zawiera `Legacy_Identifier`.
12. **Round-trip OpenAPI (round-trip; Wymaganie 12).** Wygenerowana specyfikacja OpenAPI dla `REST_API` parsuje się i serializuje z powrotem do tej samej struktury logicznej (po normalizacji kolejności pól).
13. **Limit prędkości jest deterministyczny per token (invariant; Wymaganie 16).** Dla losowego `Agent_Token` i sekwencji wywołań w oknie czasu, liczba zaakceptowanych wywołań równa się `min(liczba_wywołań, limit)`. Test property-based.
14. **Kompatybilność wsteczna `Scheduler_UI` (invariant; Wymaganie 17).** Każdy istniejący endpoint w `apps/backend/src/api/routes/*.controller.ts` zachowuje swój publiczny kontrakt po wprowadzeniu `Agent_Bridge` (regresja snapshot OpenAPI dla istniejącego API wewnętrznego).

## Open Questions

Następujące decyzje należy potwierdzić w fazie projektowej. Założenia podane w nawiasach są wykorzystywane jako wartości domyślne na potrzeby tego dokumentu.

1. **Kanoniczna nazwa organizacji GitHub i scope npm.** Założenie: `PostSiderHQ` jako organizacja GitHub i `@postsider/` jako scope npm. Do potwierdzenia (istniejący pakiet `@postsider/node` sugeruje już wybór scope, ale dokumentacja wciąż wskazuje `gitroomhq`).
2. **Strategia migracji aliasów `@gitroom/*`.** Założenie: faza przejściowa z deprecation warning (Wymaganie 2). Do decyzji: czy wykonać hard-cut w jednym release.
3. **Strategia migracji zmiennych środowiskowych.** Założenie: dual-read z deprecation warning (Wymaganie 6). Do decyzji: minimalny okres karencji w wydaniach.
4. **Zestaw agentów AI traktowanych priorytetowo w v1.** Założenie: Claude Code i Codex jako pierwsze klasy, Hermes i OpenClaw jako drugorzędne (testowalne, ale bez dedykowanej dokumentacji w MVP).
5. **Powierzchnia integracyjna w MVP.** Założenie: zarówno `MCP_Server`, jak i `REST_API` są częścią v1, a `Agent_SDK` jest cienkim wrapperem nad oboma. Do decyzji: czy któryś z nich można odsunąć poza v1.
6. **Pozycja `Scheduler_UI`.** Założenie: pozostaje pełnoprawnym UI z dodatkowym oznaczeniem publikacji utworzonych przez agentów. Do decyzji: czy zostaje przemianowany na "konsolę administracyjną".
7. **Tryb dostarczania zdarzeń przychodzących.** Założenie: hybrydowy — pull (na żądanie agenta) plus push (webhook subskrypcji). Do decyzji: czy w v1 tylko pull.
8. **Faktyczny stack frontendu.** Sprzeczność do rozstrzygnięcia w fazie projektowej: `CLAUDE.md` mówi o Vite ReactJS, a zależności w `package.json` (`next`, `eslint-config-next`, `@sentry/nextjs`) wskazują na Next.js. Do potwierdzenia, który stack jest faktycznie zbudowany w `apps/frontend/`.
9. **Self-hosted vs PostSider Cloud.** Założenie: `Agent_Bridge` jest dostępny w obu trybach z identycznym kontraktem; ewentualne flagi cech zostaną doprecyzowane w designie.
10. **Ujawnienie autorstwa AI.** Założenie: opcjonalna flaga organizacji `agent_disclosure_required`, która, gdy włączona, dodaje konektorowi natywny suffix lub atrybut "posted by AI agent" tam, gdzie konektor to wspiera. Do decyzji: domyślna wartość flagi.
