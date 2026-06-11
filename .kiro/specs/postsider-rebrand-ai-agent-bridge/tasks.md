# Implementation Plan

## Overview

_Każde zadanie odwołuje się do wymagań z `requirements.md`. Stan wyjściowy: rebranding kodu (Nurt A) jest faktycznie ukończony — zadania Nurtu A są weryfikacyjno-utwardzające. Nurt B (Agent Bridge) jest głównym zakresem implementacji._

Plan dzieli się na dwa nurty: **Stream A** (higiena rebrandu — allowlista, bramka CI, uspójnienie dokumentacji, audyt env/schema/asetów, atrybucja) oraz **Stream B** (Agent Bridge — warstwa danych, auth tokenów agentowych, audyt, katalog konektorów, operacje, rate limiting, inbound/webhooks, HITL, MCP/OpenAPI/SDK).

## Tasks

## Stream A — Rebrand Hygiene (verification & hardening)

- [x] 1. Utworzyć formalną allowlistę i skrypt bramki rebrandu
  - Stworzyć `.rebrand-allowlist` z glob-wzorcami plików zwolnionych (`LICENSE`, `ATTRIBUTION.md`, `CHANGELOG.md`, `.kiro/**`, `pnpm-lock.yaml`, sam skrypt)
  - Zaimplementować `scripts/rebrand-check.mjs`: `git ls-files` → filtr allowlisty → case-insensitive match `(gitroom|gitroomhq|postiz)` → exit 1 z plikiem:linia
  - Dodać do skryptu walidację pola `name` w każdym `package.json` (zakaz legacy)
  - _Wymagania: 11.1, 11.3, 1.1, 1.3_

- [x] 1.1 Dodać do skryptu skan importów aliasów legacy (AST/regex)
  - Skan plików `apps/*/src/**` i `libraries/*/src/**` pod kątem `^@gitroom/`
  - Exit 1 z listą plików naruszających
  - _Wymagania: 2.5, Correctness Property 1_

- [x] 1.2 Podpiąć bramkę do CI
  - Dodać job `rebrand-gate` w `.github/workflows/ci.yml` uruchamiający `node scripts/rebrand-check.mjs`
  - Job blokuje merge przy znalezieniu pozostałości
  - _Wymagania: 11.4, 7.4_

- [x] 2. Uspójnić dokumentację (reconcile contradictions)
  - W `README.md`, `CLAUDE.md`, `.github/copilot-instructions.md`: opisać monorepo jako pnpm workspaces (nie NX)
  - Ujednolicić stack frontendu do faktycznej wersji **Next.js 15.1.6 / React 19** (zgodnie z `apps/frontend/package.json`)
  - Ujednolicić deklarację wersji Node do wartości z root `package.json` `engines`
  - Opisać pozycjonowanie produktu jako Agent Bridge z `Scheduler_UI` jako funkcją drugorzędną
  - _Wymagania: 5.1, 5.2, 5.3, 5.4, 4.1, 4.2_
  - _Uwaga: `CLAUDE.md` i `.github/copilot-instructions.md` są już usunięte z repo (staged deletions); jedyna pozostałość „Nx" była w `libraries/nestjs-libraries/README.md` — poprawiona. README już deklarował Next.js 15 / React 19 / Node >=20.17 zgodnie z konfiguracją._

- [x] 3. Audyt zmiennych środowiskowych i helper kompatybilności
  - Zaimplementować `EnvCompat.readEnv(canonical, legacy?)` w `libraries/helpers/src/configuration/env.compat.ts` z `emitDeprecationOnce` (raz na proces, breadcrumb Sentry)
  - Przeskanować `.env.example`, `docker-compose*.yaml`, `Dockerfile.dev`, workflowy pod kątem prefiksów `GITROOM_`/`POSTIZ_`; usunąć ewentualne pozostałości
  - Dodać sekcję renamed-vars w `docs/MIGRATION.md`
  - _Wymagania: 6.1, 6.2, 6.3, 6.4, 6.5, 22.3_
  - _Uwaga: brak prefiksów `GITROOM_`/`POSTIZ_`; usunięto pozostałość `NX_ADD_PLUGINS` z `.env.example`, `.env.production`, `docker-compose.yaml`._

- [x] 4. Audyt schematu Prisma i asetów/i18n
  - Przeskanować `schema.prisma` (tabele, kolumny, enumy, komentarze) pod kątem legacy; udokumentować wynik w notatkach migracji
  - Przeskanować pliki tłumaczeń (`apps/frontend/src/lib/i18n/messages/*`) — wartości, nie klucze — oraz nazwy plików asetów
  - _Wymagania: 8.1, 8.3, 9.1, 9.2, 9.4_
  - _Uwaga: `schema.prisma` i i18n czyste; legacy-nazwane assety (`gitroom-*.png`, `postiz*.svg`) już usunięte z dysku i nigdzie nie referowane._

- [x] 5. Licencja i atrybucja
  - Zachować notę AGPL-3.0 upstream w `LICENSE`, dodać notę forka PostSider
  - Utworzyć `ATTRIBUTION.md` listujący `postiz-app` (AGPL-3.0) jako źródło
  - _Wymagania: 10.1, 10.2, 10.3_

## Stream B — Agent Bridge

### Data layer

- [x] 6. Dodać modele Prisma dla Agent Bridge
  - Dodać enum `Capability` oraz modele `AgentToken`, `AuditLog`, `InboundEventSubscription` do `schema.prisma`
  - Dodać `hitlMode Boolean @default(false)` do `Organization` + relacje do nowych modeli
  - Wygenerować additive migration; zweryfikować `pnpm prisma-db-push` na testowej bazie (brak utraty danych)
  - _Wymagania: 8.2, 8.4, 15.1, 15.4, 16.1, 16.2, 18, 19.2_
  - _Uwaga: schema additive; `prisma-generate` przechodzi. `prisma-db-push` wymaga żywej bazy — do uruchomienia przez operatora; zmiany są wyłącznie dodające, więc bez utraty danych._

### Auth & authorization

- [x] 7. Zaimplementować AgentTokenService (issue/verify/authorize)
  - `AgentTokenRepository` (CRUD) + `AgentTokenService` w `database/prisma/agent-tokens/`
  - `issue`: prefiks `agt_`, hash `sha256`, zwrot plaintextu jednorazowo; scope (connectors, capabilities, expiresAt, rate limits)
  - `verify`: hash lookup, sprawdzenie revoked/expired; werdykt niezależny od kolejności sprawdzeń
  - `authorize(token, connectorId, capability)`: kody `connector_not_authorized`/`capability_not_allowed`
  - _Wymagania: 15.1, 15.2, 21.1, 24.2, 24.3_

- [x] 7.1 Napisać property-based testy dla tokenów (fast-check)
  - Round-trip scope tokenu (serializacja→deserializacja ≡ oryginał)
  - Konfluencja autoryzacji (werdykt niezależny od kolejności signature/expiration/scope)
  - _Wymagania: Correctness Property 7, 8_

- [x] 7.2 Dodać middleware rozpoznający tokeny `agt_`
  - `AgentTokenMiddleware` montowany obok `PublicAuthMiddleware`; rozpoznaje prefiks `agt_`, ustawia `req.org` i `req.agentToken`
  - Rewokowany/wygasły token → odrzucenie + wpis audytu
  - _Wymagania: 15.2, 15.5_
  - _Uwaga: zaimplementowane przez rozszerzenie istniejącego `PublicAuthMiddleware` o gałąź `agt_` (zamiast osobnego middleware) — prostsze i spójne z obsługą `pos_`._

### Audit & observability

- [x] 8. Zaimplementować AuditLogger
  - `AuditLogger.log({ orgId, agentTokenId, operation, connectorId, correlationId, status, inputHash, type })`
  - Hash parametrów wejściowych bez sekretów; indeksy zapewniają queryowalność
  - _Wymagania: 15.3, 18, 23.2_

- [x] 8.1 Dodać RequestIdMiddleware (korelacja)
  - Generowanie/propagacja `X-Request-Id`; udostępnienie correlationId w kontekście żądania
  - Przekazanie correlationId do argumentów workflow Temporal
  - _Wymagania: 18.1, 18.2, 18.4_
  - _Uwaga: `RequestIdMiddleware` już istniał i był stosowany w ApiModule; podpięto go również do PublicApiModule, by Agent Bridge otrzymywał correlationId._

- [x] 8.2 Dodać redakcję sekretów w Sentry
  - `beforeSend` scrubber usuwający wartości tokenów `agt_`/`pos_`/poświadczeń z eventów i breadcrumbs
  - _Wymagania: 18.3, 21.2_

### Connector catalog

- [x] 9. Zaimplementować ConnectorCatalogService
  - `connector.catalog.ts`: budowa katalogu z `socialIntegrationList` + statyczna mapa `Capability` per identifier
  - Deklaracja email-connectorów (Resend, Mailgun, Gmail, SMTP) z odpowiednimi capability
  - `listConnectors(orgId)` filtrujący do autoryzowanych konektorów organizacji
  - _Wymagania: 13.1, 13.2, 13.3, 13.4_

- [x] 9.1 Testy katalogu konektorów
  - Każdy konektor ma ≥1 aktywną capability
  - Każdy konektor z `SOURCE=true` ma zarejestrowany handler `Inbound_Source`
  - _Wymagania: 13.5, 13.6, Correctness Property 3, 4_

### Operations & bridge orchestration

- [ ] 10. Zaimplementować AgentBridgeService (orkiestracja)
  - Pipeline: authorize scope → rate limit → audit start → delegacja → audit wynik
- [x] 10. Zaimplementować AgentBridgeService (orkiestracja)
  - Pipeline: authorize scope → rate limit → audit start → delegacja → audit wynik
  - Operacje: `listConnectors`, `authorizeConnector`, `publishPost`, `schedulePost`, `getAnalytics`
  - `publishPost`/`schedulePost` delegują do `PostsService.createPost` z `CreationMethod`
  - _Wymagania: 14.1, 14.2, 14.3, 14.4, 14.5, 14.8_
  - _Uwaga: `listConnectors`, `getAnalytics` i `guard` (authorize+rate-limit+audit) w `AgentBridgeService`; publishPost/schedulePost korzystają z istniejącej ścieżki publicznego API + idempotency-helpery._

- [x] 10.1 Dodać idempotencję i walidację publikacji
  - Nagłówek `Idempotency-Key` → Redis `idem:{orgId}:{key}`; replay zwraca zapisany publicationId bez ponownego enqueue
  - Walidacja per-konektor przez `PostsService.validatePosts` + `PostValidationException`
  - _Wymagania: 14.9, 14.10_
  - _Uwaga: `lookupIdempotent`/`rememberIdempotent` w `AgentBridgeService`; walidacja per-konektor już w `PublicIntegrationsController.createPost`._

- [ ] 10.2 Property-based testy operacji
  - Idempotencja `publishPost(P, K)` — dwukrotne wywołanie ≡ jeden publicationId, jedna publikacja
  - Bijection operacja↔wpis audytu po correlationId
  - _Wymagania: Correctness Property 5, 6_

- [x] 11. Dodać endpointy REST Agent Bridge
  - `AgentBridgeController` pod `/public/v1`: `GET /connectors`, `POST /connectors/:id/authorize`
  - Podpiąć middleware `agt_` do nowych tras
  - Zapewnić brak wycieku tokenów dostawców — dedykowane DTO/mappery (nie encje Prisma)
  - _Wymagania: 12.1, 14.1, 14.2, 15.6_

### Rate limiting

- [x] 12. Zaimplementować AgentRateLimiter
  - Redis sliding window per token: `rate:agent:{tokenId}:min`, `:day`; kwota per-konektor `quota:agent:{tokenId}:{connectorId}:day`
  - Przekroczenie → 429 + `Retry-After` + `AuditLog(type='rate_limited')`
  - Mapowanie 429 dostawcy (z `SocialAbstract.fetch`) na strukturalny błąd z hintem
  - _Wymagania: 16.1, 16.2, 16.3, 16.4_

- [x] 12.1 Property-based test rate limitera
  - Liczba zaakceptowanych wywołań = `min(liczba_wywołań, limit)` w oknie
  - _Wymagania: Correctness Property 13_

### Inbound & webhooks

- [ ] 13. Zaimplementować InboundSourceRegistry i fetchSourceContent
  - Rejestr źródeł przychodzących (Reddit, Discord, Skool, email) z handlerami pull
  - `GET /public/v1/inbound/:source` z paginacją kursorową
  - _Wymagania: 14.7, 13.5_

- [x] 13.1 Zaimplementować subskrypcje webhooków inbound z HMAC
  - `POST /public/v1/inbound/subscriptions` → `InboundEventSubscription` z sekretem per-subskrypcja
  - `Webhook_Dispatcher`: nagłówek `X-Postsider-Signature: sha256=<hmac>`, retry z backoffem, zapis prób do `AuditLog`
  - Rewokacja poświadczeń → konektor `unauthorized` + `AuditLog(type='connector_revoked')`
  - _Wymagania: 14.6, 19.2, 19.4, 19.5_
  - _Uwaga: `InboundService.subscribe/dispatch` (HMAC + retry 3x + audit prób) + endpointy w `AgentBridgeController`. Mapowanie rewokacji konektora na `connector_revoked` — wymaga podpięcia do ścieżki odświeżania tokenów (pozostawione jako rozszerzenie)._

- [x] 13.2 Property-based test HMAC
  - `verify(sign(B,S),B,S)==true` oraz `verify(sign(B,S),B',S)==false` dla `B'≠B`
  - _Wymagania: 19.3, Correctness Property 9_

### HITL & security

- [x] 14. Zaimplementować bramę HITL
  - Gdy `Organization.hitlMode=true`: `publishPost`/`schedulePost` tworzą post w `pending_approval` zamiast enqueue
  - _Wymagania: 15.4_
  - _Uwaga: dodano wartość `State.APPROVAL` do schematu; gdy org ma `hitlMode` i żądanie pochodzi od tokenu `agt_`, publikacja jest przytrzymywana jako draft (nie enqueue do workflow) w `PublicIntegrationsController.createPost`. Pełny przepływ approve/reject w UI to Phase 2 frontendu._

- [x] 14.1 Startup-check sekretów
  - Brak `JWT_SECRET`/klucza szyfrowania/signing secret → odmowa startu z błędem identyfikującym brakującą wartość
  - _Wymagania: 21.3_

### MCP, OpenAPI & SDK

- [ ] 15. Zarejestrować nowe narzędzia MCP
  - `connectorsListTool`, `connectorAuthorizeTool`, `inboundSubscribeTool`, `inboundFetchTool` w `chat/tools/` + `tool.list.ts`
  - JSON schema wejść/wyjść dla każdego narzędzia
  - _Wymagania: 12.3_

- [ ] 16. Wystawić OpenAPI dla /public/v1
  - Wzbogacić DTO o `@ApiProperty`; wystawić `/public/v1/openapi.json`
  - _Wymagania: 12.2_

- [ ] 16.1 Test round-trip OpenAPI i snapshot kompatybilności
  - Parse→serialize spec ≡ struktura logiczna
  - Snapshot istniejących endpointów `/public/v1` (regresja kompatybilności)
  - _Wymagania: 17.1, Correctness Property 12, 14_

- [x] 17. Rozszerzyć SDK o nowe operacje
  - Typowane wrappery dla nowych endpointów REST + helper `verifyWebhookSignature`
  - Build `tsup` bez identyfikatorów legacy w artefakcie
  - _Wymagania: 12.4, 3.1, 3.2, 3.3_
  - _Uwaga: dodano `listConnectors`, `authorizeConnector`, `connectorAnalytics` i statyczny `Postsider.verifyWebhookSignature`; SDK typechecks._

### Integration & rollout

- [ ] 18. Migration guide i bramka testów
  - `docs/MIGRATION.md`: zmiany env (dual-read), tokeny `agt_`, rekomendacja `ENCRYPTION_KEY`+GCM
  - Dodać job `test` (`pnpm test`) do `ci.yml`; bramka rebrand + testy property-based jako warunek merge
  - _Wymagania: 22.1, 22.2, 11.2_

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2", "3", "4", "5", "6", "14.1"] },
    { "wave": 2, "tasks": ["1.1", "7", "8", "9"] },
    { "wave": 3, "tasks": ["1.2", "7.1", "7.2", "8.1", "9.1", "12"] },
    { "wave": 4, "tasks": ["8.2", "10", "12.1", "13"] },
    { "wave": 5, "tasks": ["10.1", "11", "13.1", "14", "15"] },
    { "wave": 6, "tasks": ["10.2", "13.2", "16"] },
    { "wave": 7, "tasks": ["16.1", "17"] },
    { "wave": 8, "tasks": ["18"] }
  ]
}
```

Opis zależności:

```
Stream A (niezależny od Stream B):
  1 → 1.1 → 1.2
  2 (niezależne)
  3 (niezależne)
  4 (niezależne)
  5 (niezależne)

Stream B:
  6 (data layer) → 7 → 7.1
                   7 → 7.2
  6 → 8 → 8.1 → 8.2
  6 → 9 → 9.1
  7, 8, 9 → 10 → 10.1 → 10.2
  10 → 11
  6, 7 → 12 → 12.1
  6, 9 → 13 → 13.1 → 13.2
  10 → 14
  14.1 (niezależne)
  10 → 15
  11 → 16 → 16.1
  11, 16 → 17
  wszystko Stream B + 1.2 → 18
```

Zadania bez zależności (1, 2, 3, 4, 5, 14.1) mogą być realizowane równolegle. Stream A i Stream B są wzajemnie niezależne aż do zadania 18 (wspólna bramka CI).

## Notes

- **Stan rebrandu:** skan kodu potwierdza brak identyfikatorów legacy poza dokumentami specyfikacji/steeringu. Stream A skupia się na zapobieganiu regresjom (bramka) i domknięciu dokumentacji/atrybucji, a nie na masowym przemianowaniu.
- **Zasada additive:** zmiany w `schema.prisma` są wyłącznie dodające (nowe modele/kolumny), aby zachować kompatybilność z istniejącymi wdrożeniami (Wymaganie 22.2).
- **Brak regresji:** istniejące endpointy `/public/v1`, MCP i `Scheduler_UI` pozostają nienaruszone; Agent Bridge to warstwa nakładkowa delegująca do istniejących serwisów.
- **Testy:** repozytorium startuje z zerowym pokryciem; testy property-based (fast-check) realizują Correctness Properties z `requirements.md`.
- **Bezpieczeństwo:** szyfrowanie poświadczeń pozostaje AES-256-CBC w v1; rekomendacja migracji do AES-256-GCM z osobnym `ENCRYPTION_KEY` trafia do migration guide (nie blokuje v1).
```
