# Design Document

_Język dokumentu: polski. Nagłówki sekcji oraz nazwy techniczne (modele, klasy, endpointy) pozostają w języku angielskim. Dokument bazuje na faktycznym stanie repozytorium na dzień 2026-06-10._

## Overview

Ten dokument projektowy opisuje, jak zrealizować dwa nurty zdefiniowane w `requirements.md`:

- **Nurt A — Higiena kodu (rebranding).** Stan faktyczny: rebranding kodu jest **w praktyce ukończony**. Skan `grep -ril -E 'gitroom|postiz'` po wykluczeniu `node_modules`, `dist`, `.next`, `.git` zwraca wyłącznie pliki dokumentów specyfikacji (`.kiro/specs/*`, `.kiro/steering/*`), które z definicji opisują migrację i są na allowliście. Aliasy ścieżek to już `@postsider/*`, nazwa root package to `postsider`. Pozostała praca w Nurcie A jest więc **głównie weryfikacyjno-utwardzająca**: formalna allowlista, automatyczna bramka CI wykrywająca regresje, uspójnienie kilku rozbieżności w dokumentacji (Next.js 15 vs 16, wersja Node), oraz audyt zmiennych środowiskowych i schematu Prisma pod kątem ewentualnych pozostałości.

- **Nurt B — Agent Bridge.** Stan faktyczny: istnieje dojrzała, ale **fragmentaryczna** baza: serwer MCP (Mastra) z ~15 narzędziami, publiczne REST API pod `/public/v1`, pakiet SDK, rate limiter per-organizacja (Redis), webhooki wychodzące z retry, szyfrowanie poświadczeń (AES-256-CBC). **Brakuje** spójnej warstwy: formalnego modelu `Connector`/`Capability`, scope'owanego `Agent_Token` (per organizacja/konektor/capability), audit logu, podpisów HMAC webhooków, korelacji żądań (X-Request-Id), trybu HITL oraz spójnej specyfikacji OpenAPI.

Projekt celowo **nie przepisuje** istniejących elementów, lecz nakłada na nie cienką, spójną warstwę abstrakcji (`Agent_Bridge`), która konsoliduje rozproszone mechanizmy.

### Design Goals

1. Zero regresji dla istniejącego `Scheduler_UI` i obecnego publicznego API (kompatybilność wsteczna — Wymaganie 17, 22).
2. Jedna powierzchnia, trzy fasady: `MCP_Server`, `REST_API` (`/public/v1`), `Agent_SDK` współdzielą tę samą warstwę domenową (Wymaganie 12).
3. Bezpieczeństwo domyślne: scope'owane tokeny, audyt każdej operacji, szyfrowanie sekretów, brak wycieku tokenów dostawców do agentów (Wymagania 15, 19, 21).
4. Migracja bez przestojów: dual-read zmiennych środowiskowych, fazy przejściowe aliasów (Wymagania 6, 22).

### Non-Goals (zgodnie z sekcją Out of Scope w requirements)

- Nowe integracje platform społecznościowych.
- Implementacja runtime'ów agentów (Claude Code, Codex itd.).
- Przeprojektowanie wizualne UI lub migracja Next.js ↔ Vite.
- Zmiany w modelu cenowym / Stripe / Polar.

## Architecture

### Wysokopoziomowy widok

```
                         ┌─────────────────────────────────────────┐
   AI Agents             │            PostSider_System              │
 (Claude Code,           │                                          │
  Codex, …)              │   ┌────────────────────────────────┐     │
       │                 │   │        Agent_Bridge layer        │     │
       │  MCP / REST      │   │  (cienka warstwa domenowa)       │     │
       ├────────────────▶│──▶│  - AgentTokenService             │     │
       │                 │   │  - AuditLogger                   │     │
       │  SDK (wrapper)   │   │  - ConnectorCatalogService       │     │
       └────────────────▶│   │  - AgentRateLimiter              │     │
                         │   │  - HITL gate                     │     │
                         │   └───────────┬──────────────────────┘     │
                         │               │  deleguje do istniejących  │
                         │   ┌───────────▼──────────────────────┐     │
                         │   │  PostsService / IntegrationService│     │
                         │   │  IntegrationManager / Webhooks    │     │
                         │   │  Temporal workflows (orchestrator)│     │
                         │   └──────────────────────────────────┘     │
                         └─────────────────────────────────────────┘
```

### Zasada warstwowa

`Agent_Bridge` **nie zawiera logiki biznesowej publikacji** — deleguje do istniejących serwisów (`PostsService.createPost`, `IntegrationService`, `MediaService`). Jego rolą jest:

1. Uwierzytelnienie i autoryzacja scope'u (`AgentTokenService`).
2. Audyt (`AuditLogger`).
3. Egzekwowanie limitów (`AgentRateLimiter`).
4. Brama HITL (przekierowanie do `pending_approval` zamiast natychmiastowej publikacji).
5. Mapowanie konektorów na `Capability` (`ConnectorCatalogService`).

Dzięki temu publikacja utworzona przez agenta i przez UI trafia do **tego samego modelu danych** (Wymaganie 17.2).

## Stream A — Rebrand Hygiene

### A.1 Stan istniejący i strategia domknięcia

Ponieważ kod jest już przemianowany, Nurt A sprowadza się do **utwardzenia i weryfikacji**. Decyzje projektowe:

| Wymaganie | Stan | Działanie projektowe |
|-----------|------|----------------------|
| R1 nazwy pakietów | ✅ `postsider`, `@postsider/*` | Dodać test/skrypt weryfikujący `name` w każdym `package.json`. |
| R2 aliasy TS | ✅ `@postsider/*` | Skaner AST w CI (zakaz `^@gitroom/`). Faza przejściowa aliasów **nie jest potrzebna** (brak importów legacy) — pomijamy deprecation, idziemy hard-cut (decyzja do Open Question 2). |
| R3 SDK | ✅ | Krok CI: grep artefaktu `dist/` SDK. |
| R4 dokumentacja | ⚠️ częściowo | Uspójnić `README.md`, `CLAUDE.md`, `.github/copilot-instructions.md`. |
| R5 sprzeczności | ⚠️ | Rozstrzygnąć: pnpm workspaces (nie NX), Next.js — patrz A.3. |
| R6 zmienne środowiskowe | ⚠️ audyt | `EnvCompat` helper + skan `.env.example`. |
| R7 CI/CD/Docker | ✅ głównie | Grep w bramce. |
| R8 schemat DB | ⚠️ audyt | Skan `schema.prisma` — brak identyfikatorów legacy stwierdzony; udokumentować w notatkach migracji. |
| R9 i18n/asety | ⚠️ | Skan wartości tłumaczeń i nazw plików asetów. |
| R10 licencja | ⚠️ | Dodać `ATTRIBUTION.md`, zachować notę AGPL upstream. |
| R11 bramka | ❌ brak | **Główny deliverable Nurtu A** — patrz A.2. |

### A.2 Rebrand Verification Gate (Requirement 11)

Centralny artefakt: skrypt `scripts/rebrand-check.mjs` uruchamiany w CI.

**Algorytm:**

1. Wczytaj `.rebrand-allowlist` (lista glob-wzorców plików zwolnionych).
2. Zbierz pliki śledzone przez git (`git ls-files`), odfiltruj allowlistę oraz `node_modules`/`dist`/`.next`.
3. Dla każdego pliku wykonaj case-insensitive match `/(gitroom|gitroomhq|postiz)/i`.
4. Dla plików TS dodatkowo: AST/regex skan importów `^@gitroom/` (Correctness Property 1).
5. Sprawdź pole `name` w każdym `package.json` (Correctness Property 11).
6. Jeśli jakikolwiek match poza allowlistą → exit 1 z listą plików i numerów linii.

**`.rebrand-allowlist`** (wstępna zawartość):
```
LICENSE
ATTRIBUTION.md
CHANGELOG.md
.kiro/specs/**
.kiro/steering/**
.rebrand-allowlist
scripts/rebrand-check.mjs
pnpm-lock.yaml
```
> Uwaga: `pnpm-lock.yaml` na allowliście, bo może zawierać tranzytywne pakiety upstream; alternatywnie zawęzić wzorzec do konkretnych linii. `.kiro/**` na allowliście, bo dokumenty migracyjne z natury opisują nazwy legacy.

**Integracja CI** (`.github/workflows/ci.yml`): nowy job `rebrand-gate` (needs: brak; równolegle do `typecheck`), uruchamiający `node scripts/rebrand-check.mjs`. Bramka blokuje merge (Wymaganie 11.4).

### A.3 Reconcile contradictions (Requirement 5)

- **Monorepo:** pnpm workspaces (potwierdzone `pnpm-workspace.yaml`, brak `nx.json`). Zaktualizować każdy dokument mówiący o NX.
- **Frontend stack:** `apps/frontend/package.json` jest źródłem prawdy. Requirements (frontend-admin-panel R2.1) deklarują Next.js 16; `README.md` mówi Next.js 15. **Decyzja:** zweryfikować realną wersję w `apps/frontend/package.json` i ujednolicić wszystkie dokumenty do tej wartości. Design nie wymusza wersji — wymusza spójność (Wymaganie 5.2, 5.4).
- **Node engines:** root `package.json` deklaruje `>=20.17.0 <23.0.0`; frontend spec mówi `>=22.12.0`. Ujednolicić do wartości z root `engines` lub świadomie podnieść — decyzja operatora, udokumentowana w migration guide.
- **Pozycjonowanie:** dokumentacja opisuje produkt jako Agent Bridge z `Scheduler_UI` jako funkcją drugorzędną (Wymaganie 5.3).

### A.4 Environment variable migration (Requirement 6)

Helper `EnvCompat` w `libraries/helpers/src/config/env.compat.ts`:

```ts
// pseudokod
export function readEnv(canonical: string, legacy?: string): string | undefined {
  if (process.env[canonical] != null) return process.env[canonical];
  if (legacy && process.env[legacy] != null) {
    emitDeprecationOnce(legacy, canonical); // raz na proces (Wymaganie 22.3)
    return process.env[legacy];
  }
  return undefined;
}
```

- `emitDeprecationOnce` korzysta z modułowego `Set`, by ostrzeżenie pojawiło się **raz na proces** (Correctness Property 10, Wymaganie 22.3) i wysyła zdarzenie do `Observability_System` (Sentry breadcrumb).
- Audyt: skan `.env.example`, `docker-compose*.yaml`, `Dockerfile.dev`, workflowy. Realnie prefiksy `GITROOM_`/`POSTIZ_` nie występują — helper jest mechanizmem zapewniającym **brak regresji** i kompatybilność przy ewentualnych zmianach prefiksów w przyszłości. Migration guide (`docs/MIGRATION.md`) wylistuje wszelkie przyszłe zmiany nazw.

### A.5 License & attribution (Requirement 10)

- `LICENSE` — zachować oryginalną notę AGPL-3.0 upstream, dodać notę forka PostSider.
- Nowy `ATTRIBUTION.md` listujący `postiz-app` (AGPL-3.0) jako źródło.

## Stream B — Agent Bridge

### B.1 Data model (Prisma)

Nowe modele w `schema.prisma`. **Zasada:** tylko dodajemy (additive migration), nie zmieniamy istniejących kolumn → brak utraty danych (Wymaganie 8.4, 22.2).

```prisma
enum Capability {
  PUBLISH
  SOURCE
  ANALYTICS
  SCHEDULE
}

model AgentToken {
  id             String       @id @default(uuid())
  organizationId String
  name           String
  // Hash jednokierunkowy (Wymaganie 21.1). Plaintext nigdy nie trafia do DB.
  tokenHash      String       @unique
  // Scope:
  connectors     String[]     // identyfikatory konektorów; [] = wszystkie autoryzowane
  capabilities   Capability[] // dozwolone capability
  // Limity (Wymaganie 16):
  rateLimitPerMinute Int      @default(60)
  rateLimitPerDay    Int      @default(10000)
  expiresAt      DateTime?
  revokedAt      DateTime?
  lastUsedAt     DateTime?
  createdAt      DateTime     @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id])

  auditLogs      AuditLog[]
  @@index([organizationId])
  @@index([tokenHash])
  @@index([revokedAt])
}

model AuditLog {
  id              String       @id @default(uuid())
  organizationId  String
  agentTokenId    String?
  operation       String       // np. "publishPost"
  connectorId     String?
  correlationId   String       // identyfikator korelacji (Wymaganie 18)
  status          String       // "ok" | "error" | "rate_limited" | "connector_not_authorized" | ...
  inputHash       String?      // hash parametrów (Wymaganie 15.3) — bez sekretów
  type            String?      // "rate_limited" | "connector_revoked" | ...
  createdAt       DateTime     @default(now())
  organization    Organization @relation(fields: [organizationId], references: [id])
  agentToken      AgentToken?  @relation(fields: [agentTokenId], references: [id])

  @@index([organizationId])
  @@index([agentTokenId])
  @@index([connectorId])
  @@index([correlationId])
  @@index([createdAt])
}

model InboundEventSubscription {
  id              String   @id @default(uuid())
  organizationId  String
  sources         String[] // identyfikatory Inbound_Source
  webhookUrl      String
  secret          String   // per-subskrypcja, do HMAC (Wymaganie 19.2)
  createdAt       DateTime @default(now())
  revokedAt       DateTime?
  organization    Organization @relation(fields: [organizationId], references: [id])
  @@index([organizationId])
}
```

Dodatkowo: do modelu `Organization` dodajemy `hitlMode Boolean @default(false)` (Wymaganie 15.4) oraz relacje do nowych modeli. Idempotencja publikacji (Wymaganie 14.10): klucz idempotencji przechowywany w Redis (`idem:{orgId}:{key}` → publicationId, TTL = okno deduplikacji), bez nowej tabeli.

> **Decyzja:** scope `connectors`/`capabilities` jako `String[]`/`Capability[]` (Postgres array) zamiast tabel pośrednich — prostsze, wystarczające dla v1, łatwy round-trip serializacji (Correctness Property 7).

### B.2 Connector abstraction & catalog (Requirement 13)

Capabilities nie istnieją dziś formalnie. Wprowadzamy je **deklaratywnie**, bez zmiany istniejących providerów, przez rejestr metadanych.

`ConnectorCatalogService` (`libraries/nestjs-libraries/src/integrations/connector.catalog.ts`):

```ts
interface ConnectorDefinition {
  identifier: string;          // pokrywa się z provider.identifier
  label: string;               // provider.name
  iconUrl: string;
  capabilities: Capability[];  // deklarowane
  requiredScopes: Record<Capability, string[]>;
}
```

- Katalog budowany z `socialIntegrationList` (`IntegrationManager`) + statyczna mapa capability per identifier (tabela w kodzie). Każdy konektor MUSI mieć ≥1 capability (Correctness Property 3 — test jednostkowy waliduje).
- Capability wnioskowane z możliwości providera:
  - `PUBLISH` — provider ma metodę publikacji (większość social).
  - `SCHEDULE` — provider wspiera planowanie (wszystkie przez Temporal).
  - `ANALYTICS` — provider implementuje `analytics()` (sprawdzane przez obecność metody).
  - `SOURCE` — konektory przychodzące: Reddit, Discord, Skool + email (Gmail, Mailgun, Resend, SMTP). Dla każdego `SOURCE=true` MUSI istnieć handler `Inbound_Source` (Correctness Property 4).
- `listConnectors(orgId)` zwraca katalog przefiltrowany do konektorów autoryzowanych przez organizację (Wymaganie 13.4, 14.1).

**Email jako konektory `SOURCE`/`PUBLISH`:** dziś `EmailService` obsługuje tylko wysyłkę transakcyjną (Resend/Nodemailer). Dla v1 email-connectory (Mailgun, Gmail, SMTP) deklarujemy w katalogu; implementacja `Inbound_Source` dla email = adapter pobierający wiadomości (pull). Gmail social provider już istnieje — mapujemy go.

### B.3 Agent token auth (Requirement 15)

**Problem:** dziś auth jest pofragmentowany — `Organization.apiKey` (legacy, używany realnie), model `ApiKey` (zarządzany, ale nie używany w walidacji), tokeny OAuth `pos_`.

**Decyzja:** wprowadzamy `AgentToken` jako **trzecią, scope'owaną ścieżkę**, prefiks `agt_`. Nie usuwamy istniejących ścieżek (kompatybilność — Wymaganie 17.4). `AuthService`/middleware rozszerzamy o rozpoznanie `agt_`.

`AgentTokenService` (`libraries/nestjs-libraries/src/database/prisma/agent-tokens/`):

```ts
issue(orgId, { name, connectors, capabilities, expiresAt, rateLimits }):
  raw = 'agt_' + makeId(40)
  tokenHash = sha256(raw)                 // jednokierunkowy (Wymaganie 21.1)
  persist({ tokenHash, scope... })
  return raw                              // plaintext zwracany RAZ (Wymaganie 24.3)

verify(raw): // (Wymaganie 15.2)
  hash = sha256(raw)
  token = findByHash(hash)
  if !token || token.revokedAt || (token.expiresAt && expired) → reject
  return { org, scope }                   // werdykt niezależny od kolejności sprawdzeń (Property 8)

authorize(token, operation, connectorId, capability):
  if connectorId not in token.connectors (gdy lista niepusta) → connector_not_authorized
  if capability not in token.capabilities → forbidden
```

- Hash: `sha256` (nie bcrypt) — tokeny losowe o wysokiej entropii, potrzebny szybki lookup po unikalnym indeksie. To zgodne z Wymaganiem 21.1 (jednokierunkowość; plaintext nieodtwarzalny).
- Rewokacja (`revokedAt`) → każde kolejne użycie odrzucone + wpis `AuditLog` (Wymaganie 15.5).
- **Brak wycieku tokenów dostawców:** warstwa serializacji odpowiedzi Agent_Bridge przepuszcza dane przez whitelistę pól; surowe `Integration.token`, `ProviderCredentials.clientSecret` itd. nigdy nie wchodzą do DTO zwracanego agentowi (Wymaganie 15.6, 19 — test). Implementacja: dedykowane DTO (mappery), nie zwracanie encji Prisma.

### B.4 Operations (Requirement 14)

Operacje wystawiane jako (a) narzędzia MCP, (b) endpointy REST `/public/v1`, (c) metody SDK. Wszystkie przechodzą przez `AgentBridgeService`, który: autoryzuje scope → sprawdza rate limit → loguje audyt → deleguje → loguje wynik.

| Operacja | REST | Delegacja | Uwagi |
|----------|------|-----------|-------|
| `listConnectors` | `GET /public/v1/connectors` | `ConnectorCatalogService` | ≤500ms p95 (NF1) |
| `authorizeConnector` | `POST /public/v1/connectors/:id/authorize` | istniejący OAuth flow (`/social/:integration`) | zwraca URL OAuth lub „already authorized" |
| `publishPost` | `POST /public/v1/posts` (istnieje) | `PostsService.createPost` (CreationMethod=API/MCP) | idempotency-key (14.10), walidacja per-konektor (14.9) |
| `schedulePost` | `POST /public/v1/posts` z `date` | jw. | timestamp przyszły |
| `getAnalytics` | `GET /public/v1/analytics/:integration` (istnieje) | `IntegrationService.checkAnalytics` | błąd gdy brak `ANALYTICS` capability |
| `subscribeToInboundEvents` | `POST /public/v1/inbound/subscriptions` | `InboundEventSubscription` + `Webhook_Dispatcher` | HMAC |
| `fetchSourceContent` | `GET /public/v1/inbound/:source` | `Inbound_Source` adapter | paginacja kursorowa |

- **Idempotencja (14.10, Property 6):** nagłówek `Idempotency-Key`. Przed `createPost` sprawdź Redis; jeśli klucz istnieje → zwróć zapisany `publicationId` bez ponownego enqueue.
- **Walidacja (14.9):** wykorzystać istniejące `PostsService.validatePosts` + `PostValidationException` (już używane w publicznym kontrolerze).
- **Autoryzacja konektora (14.8):** brak autoryzacji → kod `connector_not_authorized` + wpis audytu.

### B.5 Agent rate limiting & quotas (Requirement 16)

Rozszerzamy istniejący wzorzec `ApiRateLimitGuard` (Redis sliding window) o wariant per-`AgentToken`:

- `AgentRateLimiter`: klucze `rate:agent:{tokenId}:min` (TTL 60s) i `rate:agent:{tokenId}:day` (TTL 86400s), limity z pól `AgentToken.rateLimitPerMinute/PerDay`.
- Kwota per-konektor: `quota:agent:{tokenId}:{connectorId}:day`.
- Przekroczenie → HTTP 429 + `Retry-After` + wpis `AuditLog(type='rate_limited')` (Wymaganie 16.3, Property 13).
- Błąd rate-limit dostawcy (z `SocialAbstract.fetch`, który już wykrywa 429) → mapowany na strukturalny błąd z hintem (Wymaganie 16.4).

### B.6 Webhooks & inbound security (Requirement 19)

Rozszerzamy istniejący `sendWebhooks` (orchestrator) i wprowadzamy `Webhook_Dispatcher` dla zdarzeń inbound:

- **HMAC:** nagłówek `X-Postsider-Signature: sha256=<hex>` = HMAC-SHA256(secret subskrypcji, body) (Wymaganie 19.2, Property 9).
- SDK helper `verifyWebhookSignature(body, signature, secret)` (Wymaganie 19.3).
- Retry z backoffem (już istnieje 3 próby) + zapis każdej próby do `AuditLog` (Wymaganie 19.4).
- Rewokacja poświadczeń dostawcy → oznaczenie konektora `unauthorized` + `AuditLog(type='connector_revoked')` (Wymaganie 19.5).
- **Szyfrowanie at rest (19.1, 21):** poświadczenia już szyfrowane AES-256-CBC (`AuthService.fixedEncryption`). **Ryzyko do udokumentowania:** klucz pochodzi z `JWT_SECRET`, IV jest deterministyczny (md5 z sekretu), brak per-rekordowego losowego IV i auth-tag (CBC, nie GCM). Design **nie zmienia** tego w v1 (ryzyko migracji danych), ale dodaje notę bezpieczeństwa i rekomendację (osobny `ENCRYPTION_KEY` + AES-256-GCM) do migration guide. Startup-check: brak `JWT_SECRET`/klucza szyfrowania → odmowa startu (Wymaganie 21.3).

### B.7 Observability (Requirement 18, 23)

- **Correlation ID:** middleware `RequestIdMiddleware` (`apps/backend`) generujący/propagujący `X-Request-Id`. Dziś brak. Propagacja do Temporal: przekazać `correlationId` w argumentach workflow (Wymaganie 18.2).
- Każda operacja Agent_Bridge: structured log start (operation, tokenId, orgId, correlationId) — Wymaganie 18.1.
- Błąd → Sentry event z correlationId + zredagowane parametry (Wymaganie 18.3). Sentry już zainicjalizowany; dodać redakcję tokenów (`beforeSend` scrubber).
- `AuditLog` queryowalny po org/token/connector/zakres czasu (Wymaganie 23.2) — zapewnione przez indeksy.

### B.8 OpenAPI & SDK (Requirement 12)

- **OpenAPI:** `@nestjs/swagger` już obecny. Wzbogacić kontroler `/public/v1` o `@ApiProperty` w DTO i wystawić `/public/v1/openapi.json`. Round-trip parse/serialize testowany (Property 12).
- **MCP:** zarejestrować narzędzia odpowiadające operacjom z B.4 z JSON schema (Wymaganie 12.3). Wykorzystać istniejący mechanizm Mastra `tools`.
- **SDK** (`apps/sdk`): dodać typowane wrappery dla nowych endpointów + helper HMAC. Build (`tsup`) bez identyfikatorów legacy (Wymaganie 3).
- **Wersjonowanie:** zmiana łamiąca → nowy segment (`/public/v2`), `v1` utrzymane ≥1 cykl (Wymaganie 12.5).

## Components and Interfaces

### Nowe komponenty (NestJS, w `libraries/nestjs-libraries/src/`)

| Komponent | Plik | Odpowiedzialność |
|-----------|------|------------------|
| `AgentTokenService` | `database/prisma/agent-tokens/agent-token.service.ts` | issue/verify/authorize/revoke/rotate |
| `AgentTokenRepository` | `database/prisma/agent-tokens/agent-token.repository.ts` | CRUD Prisma |
| `AuditLogger` | `database/prisma/audit/audit.logger.ts` | persist wpisów audytu |
| `ConnectorCatalogService` | `integrations/connector.catalog.ts` | katalog + capability |
| `AgentBridgeService` | `agent-bridge/agent-bridge.service.ts` | orkiestracja operacji |
| `AgentRateLimiter` | `services/agent-rate-limit.guard.ts` | limity per-token |
| `InboundSourceRegistry` | `integrations/inbound/inbound.registry.ts` | rejestr źródeł przychodzących |
| `WebhookDispatcher` (rozszerzenie) | `database/prisma/webhooks/` | HMAC + retry + audit |
| `EnvCompat` | `helpers/src/config/env.compat.ts` | dual-read env |
| `RequestIdMiddleware` | `apps/backend/src/services/request-id.middleware.ts` | korelacja |

### Nowe endpointy (backend)

Middleware `AgentTokenMiddleware` (rozpoznaje `agt_`) montowany obok `PublicAuthMiddleware`. Endpointy z B.4 dodane do `PublicIntegrationsController` lub nowego `AgentBridgeController` pod `/public/v1`.

### Nowe narzędzia MCP

`connectorsListTool`, `connectorAuthorizeTool`, `inboundSubscribeTool`, `inboundFetchTool` w `chat/tools/` + rejestracja w `tool.list.ts`.

## Data Models

Patrz B.1. Migracja Prisma: pojedynczy plik `migrations/<ts>_agent_bridge/migration.sql` (additive). Test na bazie z reprezentatywnymi danymi (Wymaganie 8.4).

## Error Handling

Ujednolicony format błędu Agent_Bridge:

```json
{ "error": { "code": "connector_not_authorized", "message": "...", "retryAfter": 30 } }
```

Kody: `connector_not_authorized`, `capability_not_allowed`, `validation_failed`, `rate_limited`, `token_revoked`, `token_expired`, `analytics_not_supported`, `idempotent_replay`. Każdy błąd autoryzacyjny/limitowy generuje wpis `AuditLog`.

## Testing Strategy

Repozytorium ma dziś zerowe pokrycie; wprowadzamy Jest (już w devDependencies root).

**Testy property-based (fast-check)** — realizują Correctness Properties z requirements:

1. Skaner braku importów legacy (Property 1) — test integracyjny w bramce.
2. Grep allowlisty (Property 2) — `rebrand-check.mjs` + test.
3. Każdy konektor ≥1 capability (Property 3) — test jednostkowy katalogu.
4. `SOURCE=true` ⇒ handler istnieje (Property 4) — test enumeracyjny.
5. Bijection operacja↔audyt (Property 5) — property-based.
6. Idempotencja `publishPost` (Property 6) — property-based.
7. Round-trip scope tokenu (Property 7) — property-based.
8. Konfluencja autoryzacji (Property 8) — property-based.
9. HMAC verify/sign (Property 9) — property-based.
10. Dual-read env preferuje canonical (Property 10) — property-based na (canonical_set, legacy_set).
11. Spójność `name` w package.json (Property 11) — test.
12. Round-trip OpenAPI (Property 12) — test.
13. Determinizm rate-limit per token (Property 13) — property-based.
14. Snapshot OpenAPI istniejącego API (Property 14) — regresja kompatybilności.

**Bramka CI:** rozszerzyć `ci.yml` o job `rebrand-gate` + `test` (`pnpm test`).

## Correctness Properties

Lista testowalnych właściwości (z `requirements.md`), które design realizuje. Każda jest mapowana na komponent i strategię testową:

### Property 1: Brak importów legacy
Skaner AST/regex w `rebrand-check.mjs` (A.2). Test integracyjny w bramce CI.
**Validates: Requirements 2.5, 11.1**

### Property 2: Brak `Legacy_Identifier` poza allowlistą
`rebrand-check.mjs` + `.rebrand-allowlist` (A.2).
**Validates: Requirements 11.1, 11.3**

### Property 3: Każdy konektor ma ≥1 capability
`ConnectorCatalogService` (B.2). Test jednostkowy katalogu.
**Validates: Requirements 13.3**

### Property 4: `SOURCE=true` implikuje handler `Inbound_Source`
`InboundSourceRegistry` (B.6). Test enumeracyjny.
**Validates: Requirements 13.5**

### Property 5: Bijection operacja↔audyt
`AgentBridgeService` + `AuditLogger` po correlationId (B.4, B.7). Property-based.
**Validates: Requirements 15.3, 18.1**

### Property 6: Idempotencja publikacji
Redis idempotency-key (B.4). Property-based.
**Validates: Requirements 14.10**

### Property 7: Round-trip scope tokenu
`AgentTokenService` serializacja scope (B.3). Property-based.
**Validates: Requirements 15.1**

### Property 8: Konfluencja autoryzacji
`AgentTokenService.verify` (B.3). Property-based.
**Validates: Requirements 15.2**

### Property 9: HMAC verify/sign
`Webhook_Dispatcher` + SDK helper (B.6). Property-based.
**Validates: Requirements 19.2, 19.3**

### Property 10: Dual-read env preferuje canonical
`EnvCompat` (A.4). Property-based.
**Validates: Requirements 6.3**

### Property 11: Spójność `name` w package.json
`rebrand-check.mjs` (A.2). Test.
**Validates: Requirements 1.1, 1.3**

### Property 12: Round-trip OpenAPI
generator OpenAPI (B.8). Test.
**Validates: Requirements 12.2**

### Property 13: Determinizm rate-limit per token
`AgentRateLimiter` (B.5). Property-based.
**Validates: Requirements 16.1**

### Property 14: Kompatybilność wsteczna `Scheduler_UI`
snapshot OpenAPI istniejącego API (B.8). Test regresyjny.
**Validates: Requirements 17.1**

## Migration & Rollout

- `docs/MIGRATION.md` — pojedynczy przewodnik (Wymaganie 22.1): zmiany env (dual-read), nowe tokeny `agt_`, rekomendacja `ENCRYPTION_KEY`.
- Kolejność wdrożenia: (1) Prisma migration additive → (2) auth `agt_` → (3) katalog konektorów → (4) operacje → (5) rate limit/audit → (6) webhooks/inbound → (7) OpenAPI/SDK → (8) bramka rebrand + testy.
- Brak zmian łamiących dla istniejących wdrożeń (dual-read, additive schema).

## Open Questions (decyzje z requirements — założenia projektowe)

1. Kanoniczna nazwa: `@postsider/` (potwierdzone w kodzie). GitHub org `PostSiderHQ` — do potwierdzenia w dokumentacji.
2. Aliasy `@gitroom/*`: **hard-cut** (brak importów legacy, faza przejściowa zbędna).
3. Karencja env: dual-read bezterminowy do następnego major; usunięcie w migration guide.
4. Priorytet agentów: Claude Code, Codex w v1.
5. Powierzchnia MVP: MCP + REST + cienki SDK.
6. `Scheduler_UI`: pozostaje, oznaczenie publikacji agentowych w Phase 2 frontendu.
7. Inbound: hybryda pull + push (webhook).
8. Frontend stack: ujednolicić do realnej wersji z `apps/frontend/package.json`.
9. Self-hosted vs Cloud: identyczny kontrakt Agent_Bridge.
10. Ujawnienie AI: flaga org `agent_disclosure_required` (poza v1 backendu, placeholder).
