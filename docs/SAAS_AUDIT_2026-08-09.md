# PostSider SaaS Audit — 2026-08-09

Pełny audyt gotowości SaaS dla PostSidera. Obejmuje infrastrukturę, izolację tenantów,
bezpieczeństwo API, schemat bazy danych i skalowalność na 100 klientów.

**Stan na żywo:** 12 kontenerów healthy, 8 organizacji, 8 użytkowników, 2 posty, 9 integracji.
**VPS:** OVH, 11 GB RAM (5.2 GB wolne), 6 CPU, 96 GB dysk (53% użyte), Ubuntu 26.04 LTS.

---

## 1. INFRASTRUKTURA

### 1.1 Kontenery — stan live

| Kontener | Limit RAM | Użycie RAM | Porty | Uwagi |
|----------|-----------|------------|-------|-------|
| postsider-app | 3072M | 1656M (55%) | 127.0.0.1:5000 | Backend + frontend + orchestrator (pm2) |
| postsider-postgres | 384M | 39M (10%) | internal | Baza aplikacji |
| postsider-redis | 192M | 6M (3%) | internal | volatile-lru, 128MB maxmemory |
| postsider-minio | 256M | 61M (24%) | 127.0.0.1:9000-9001 | Storage |
| postsider-temporal | 512M | 305M (60%) | internal | Temporal server |
| postsider-temporal-es | 768M | 391M (51%) | internal | Elasticsearch dla Temporal |
| postsider-temporal-pg | 192M | 93M (48%) | internal | Temporal Postgres |
| postsider-temporal-ui | 128M | 5M (4%) | 127.0.0.1:8080 | Temporal UI |
| postsider-dbgate | 192M | 5M (3%) | 127.0.0.1:8082 | Database GUI |

### 1.2 Bezpieczeństwo sieciowe

**UFW:** active, default deny incoming. Otwarte tylko 22, 80, 443.
Wszystkie porty kontenerów bindowane na 127.0.0.1 — Docker nie omija firewalla.

**TLS:** certy Let's Encrypt, auto-renew przez certbot.timer.
Wszystkie domeny (app.postsider.com, api.postsider.com, storage.postsider.com,
darkdynasty.cloud, analytics.darkdynasty.cloud) HTTPS.

**nginx host:** HSTS, nosniff, Referrer-Policy, server_tokens off, body limit 512m.
**nginx kontenera:** wewnątrz postsider-app, proxy na backend:3000 + frontend:4200.

### 1.3 Monitoring

- `vps-monitor.timer` (co 2 min): health-check 12 kontenerów, RAM, dysk, Temporal pollers na `main`, posty zaległe w QUEUE. Alerty Telegram.
- `vps-backup.timer` (codziennie 03:30 UTC): backup n8n + PostSider (pg_dump, temporal, MinIO, config), rotacja 7 dni. Ostatni: OK (589M, 46G wolne).
- `/health/workers` (orchestrator :3002): 503 gdy worker nie pollinguje. Container healthcheck sprawdza wszystkie 3 endpointy.

### 1.4 Backupy

**TAK — lokalne, codzienne.** n8n (SQLite VACUUM INTO, workflows, credentials, config+key) + PostSider (pg_dump -Fc, temporal pg_dumpall, MinIO tar, env, compose).

**BRAK — offsite backup.** `rclone` nie zainstalowane. Pojedynczy VPS = single point of failure. **RISK: HIGH** — wszystkie dane klientów na jednym hoście.

### 1.5 Wnioski infrastrukturalne

| Obszar | Status | Uwagi |
|--------|--------|-------|
| Sieć/UFW | ✅ CLEAN | Wszystkie porty 127.0.0.1 |
| TLS | ✅ CLEAN | Auto-renew, 33-81 dni ważności |
| Monitoring | ✅ CLEAN | Pokrywa 12/12 kontenerów + Temporal pollers + stuck posts |
| Healthcheck | ✅ CLEAN | Trójwarstwowy: frontend + backend + workers |
| Backupy lokalne | ✅ OK | Codzienne, rotacja 7 dni |
| Backupy offsite | 🔴 MISSING | `rclone` nie zainstalowane |
| Logi | ✅ OK | Docker json-file 20m/5 plików, journald 500M |
| Dysk | ✅ OK | 46G wolne (53% użyte) |
| RAM | ✅ OK | 5.2G wolne z 11G |

---

## 2. IZOLACJA TENANTÓW (MULTI-TENANCY)

### 2.1 Middleware autoryzacji

**AuthMiddleware** (`apps/backend/src/services/auth/auth.middleware.ts`):
- JWT weryfikowany, user re-rozwiazany z BAZY DANYCH (nie z claims JWT)
- `req.org` ustawiane z `getOrgsByUserId(user.id)` — **tylko org do której user należy**
- `users` include filtrowane `where: { userId }` — tylko membership bieżącego usera
- `disabled` membership check na `users[0].disabled` — zawsze własny rekord
- Impersonation gated na `isSuperAdmin`

**Weryfikacja:** Middleware jest sound. `req.org` nie może być org innego usera.

### 2.2 Schemat bazy danych — izolacja

**Wynik: 0 CRITICAL.** Wszystkie 30 tabel przechowujących dane tenantów ma `organizationId` (lub `orgId`) z FK do `Organization`.

Tabele BEZ organizationId (poprawnie):
- `User` — globalny (user może należeć do wielu org)
- `Organization` — to JEST tenant
- `TrialUsage` — globalny anti-abuse tracker (per email, nie per org)
- `Trending`, `Star`, `PopularPosts`, `Mentions` — dane globalne/systemowe
- `Announcement` — ogłoszenia platformowe

Tabele z FK tranzytywnym (poprawnie):
- `TagsPosts`, `IntegrationsWebhooks`, `Messages`, `Orders`, `OrderItems`, `PayoutProblems` — dziedziczą org przez parent tabele

**Brak RLS na poziomie bazy danych.** Izolacja jest application-layer (Prisma `where` clauses). To standard dla Prisma/ORM, ale oznacza że pojedynczy bug w zapytaniu może wyciec dane między tenantami. Kod był wielokrotnie audytowany (CLAUDE.md notuje kilka przeglądów bezpieczeństwa).

### 2.3 CRITICAL: Publiczny podgląd posta — cross-tenant data leak

**`GET /public/posts/:id`** (`public.controller.ts:67-88`) jest BEZ autoryzacji.
Controller NIE jest w `authenticatedController` — `AuthMiddleware` nigdy nie odpala,
`req.org` nie istnieje.

Handler woła `getPostsRecursively(id, true)` **bez `orgId`**.
W `posts.repository.ts:371-380`:
```typescript
where: {
  id,
  ...(orgId ? { organizationId: orgId } : {}),  // orgId = undefined → BEZ filtra org!
  deletedAt: null,
}
```
Gdy `orgId` jest `undefined`, zapytanie NIE MA filtra `organizationId` — KAŻDY post
z KAŻDEJ organizacji jest dostępny po samym ID.

**ID posta to `makeId(10)`** (10-znaków alfanumerycznych, NIE UUID) — przestrzeń
~839 quadrilionów, ale enumerowalna. Brak rate limiting na tym endpoincie (tylko
approval-review ma AuthRateLimitGuard).

**Wyciek danych:** response zawiera `organizationId`, `state`, `publishDate`, `releaseURL`,
`settings`, `group`, `createdAt`, `updatedAt` + dane integracji (`id`, `name`, `picture`,
`providerIdentifier`, `profile`). Tylko `error` i `childrenPost` są stripowane.

**Severity: CRITICAL.** Każdy w internecie może odczytać każdy post (draft, queued,
published, error) z dowolnej organizacji znając tylko ID posta.

**Fix:** dodać share-token (`Post.sharableToken`) generowany przy publikacji/postCreate,
wymagany w `GET /public/posts/:id`. Albo tymczasowo — przerzucić endpoint przez
AuthMiddleware i wymagać `organizationId` w where.

### 2.4 HIGH: Repository methods bez organizationId filter (defense-in-depth)

Metody w `posts.repository.ts` wołane z Temporal activities nie mają filtra `organizationId`:

| Metoda | Lokacja | Ryzyko |
|--------|---------|--------|
| `changeState(id, state)` | `posts.repository.ts:425-460` | `where: { id }` — brak orgId |
| `updatePost(id, postId, releaseURL)` | `posts.repository.ts:399-410` | `where: { id }` — brak orgId |
| `getPostByForWebhookId(id)` | `posts.repository.ts:932-956` | `where: { id }` — brak orgId |
| `getPostById(id, org?)` | `posts.repository.ts:713-739` | `org` jest opcjonalny |
| `getPostsByGroup(id, orgId?)` | `posts.repository.ts:353-369` | `orgId` jest opcjonalny |
| `getPlug(plugId)` | `integration.repository.ts:117-126` | `where: { id }` — brak orgId, include integration (token!) |
| `loadExisingData` / `saveExisingData` | `integration.repository.ts:717-744` | `where: { integrationId, methodName }` — brak orgId |
| `updateNameAndUrl(id)` | `integration.repository.ts:390-399` | `where: { id }` — brak orgId |
| `setBetweenRefreshSteps(id)` | `integration.repository.ts:368-376` | `where: { id }` — brak orgId |
| `disableIntegrations` per-channel update | `integration.repository.ts:660-668` | `where: { id: channel.id }` — brak orgId |

Wszystkie te metody są wołane z **Temporal activities** (wewnętrzny orchestrator),
więc atakujący nie ma bezpośredniej ścieżki HTTP. Ale:
- Brak defense-in-depth — jeśli application layer przepuści zły ID, baza nie ratuje
- Jeśli Temporal jest skompromitowany (workflow replay, bug w activity), brak ostatniej linii obrony
- `getPlug` **include'uje pełną integrację z tokenem** — najwyższe ryzyko

**Severity: HIGH** — ścieżka ataku wymaga dostępu do Temporala lub buga w orchestratorze,
ale potencjalny wyciek tokenów OAuth jest poważny.

**Fix:** dodać `organizationId` do każdego `where` w repository — proste, niskie ryzyko
regresji. W activity przekazywać `orgId` obok `id` (workflow już ma dostęp do `organizationId`
z payloadu).

### 2.5 HIGH: checkPreviousConnections — cross-org data leak

`integration.repository.ts:71-87` — `checkPreviousConnections(rootInternalId)` szuka
po `rootInternalId` we **WSZYSTKICH** organizacjach. Używane podczas OAuth connect
do wykrycia, czy dane konto social media jest już podłączone gdziekolwiek.

**Wyciek:** atakujący może sondować podczas OAuth flow, czy konkretne konto social
media jest podłączone do JAKIEJKOLWIEK organizacji w PostSider.

**Severity: HIGH** — enumeracja tenantów przez OAuth flow.

### 2.6 Publiczne endpointy — weryfikacja

| Endpoint | Izolacja | Uwagi |
|----------|----------|-------|
| GET /public/posts/:id | 🔴 BRAK | CRITICAL — `makeId(10)`, bez orgId filter, bez rate limiting |
| GET /public/posts/:id/comments | 🔴 BRAK | HIGH — postId enumerowalny, komentarze wszystkich orgów |
| GET /public/approval-review/:token | ✅ Token-gated | Unguessable token + rate limiting |
| Storage (MinIO) | ✅ GetObject-only | Anonimowy listing zablokowany (fix 07-22) |

### 2.7 Wnioski izolacji

| Obszar | Status |
|--------|--------|
| Auth middleware | ✅ SOUND |
| Schemat DB (FK) | ✅ SOUND (30/30 tabel) |
| Controller-level queries | ✅ Org-scoped |
| Repository-level queries (Temporal) | 🔴 HIGH — brak orgId w 10 metodach |
| RLS na DB | ⚠️ NIE MA (application-layer only) |
| MinIO anon listing | ✅ ZABLOKOWANY (GetObject-only) |
| Public post preview | 🔴 CRITICAL — cross-tenant data leak |
| Cross-org OAuth probing | 🔴 HIGH — checkPreviousConnections |

---

## 3. BEZPIECZEŃSTWO API I EGZEKUCJA PLANÓW

### 3.1 Wyniki audytu API

**0 CRITICAL, 0 HIGH** — wszystkie znalezione wcześniej luki HIGH zostały naprawione:
- ✅ Billing controller bypass (`0ba32c7`, `df1c787`) — SUPERADMIN-only
- ✅ Public API plan-limit bypass (`c42c04a`) — usunięte prefixy `/public` i `/integrations/provider/`
- ✅ Approval-flow bypass (`59c4512`) — `assertMutable()` blokuje PUBLISHED/APPROVAL
- ✅ Evergreen billing bypass (`59c4512`) — ADMIN-gated + `hasPostsQuotaRemaining()`
- ✅ Double-subscription risk (`0ba32c7`) — reuse istniejącej subskrypcji w Polar
- ✅ Zombie billing on delete (`00966df`) — `cancelActiveSubscriptionBestEffort()`
- ✅ API keys dead on arrival (`b302559`) — `getOrgByApiKey` sprawdza tabelę `ApiKey`

### 3.2 Znalezione MEDIUM (6)

| ID | Problem | Lokacja | Ryzyko |
|----|---------|---------|--------|
| M1 | Webhook controller brak @CheckPolicies | `webhooks.controller.ts:26-53` | USER może tworzyć/edytować webhooki |
| M2 | Approval controller brak @CheckPolicies | `approval.controller.ts:24-80` | Używa wewnętrznych role-checków zamiast guarda |
| M3 | GET /public/posts/:id bez autoryzacji | `public.controller.ts:67-88` | UUID-guessable = wyciek treści posta |
| M4 | TOCTOU race na channel capacity | `permissions.service.ts:84-94` | Dwa concurrent requesty mogą przekroczyć limit |
| M5 | Referer header jako CSRF fallback | `csrf.middleware.ts:60-61` | Fail-closed, akceptowalne |
| M6 | Brak walidacji POLAR_ACCESS_TOKEN przy starcie | `billing.flag.ts` | Jeśli token zniknie, wszystkie limity bypass |

### 3.3 Rate limiting

| Warstwa | Limit | Status |
|---------|-------|--------|
| Auth (login/register/forgot) | IP + email, sliding window 5 min | ✅ |
| Public API | 60/min per org | ✅ |
| Global throttler | 9999/h (domyślnie) | ⚠️ Wysoki fallback |
| GET requests | Wyłączone z global throttlera | ⚠️ |

### 3.4 SSRF / Webhook security

- **SSRF:** 3-warstwowa ochrona — DTO validator (`IsSafeWebhookUrl`) + DNS-pinned dispatcher (`ssrfSafeDispatcher`) + blokada prywatnych IP
- **Webhook dispatch:** `ssrfSafeDispatcher` na wszystkich trzech storage providerach (MinIO, R2, local)
- **Webhook signing:** Funkcje HMAC-SHA256 istnieją, ale brak kolumny `secret` w tabeli `Webhooks` (deferred)

### 3.5 Sesja / CSRF

- Cookie: `secure`, `httpOnly`, `sameSite: none` (poprawne dla cross-origin)
- CSRF middleware: Origin/Referer allowlist, fail-closed
- `NOT_SECURED` abort przy starcie w production
- CORS ograniczony do `FRONTEND_URL` + `MAIN_URL`

---

## 4. GOTOWOŚĆ NA 100 KLIENTÓW (SKALOWANIE)

### 4.1 Baza danych — connection pool

**Postgres:** max_connections = 100, obecnie 12 używanych.
**Prisma:** brak `connection_limit` w DATABASE_URL → default `num_physical_cpus * 2 + 1 = 13` połączeń na instancję.
- Backend: ~13 connections
- Orchestrator (osobny proces): ~13 connections
- **Suma: ~26 connections na instancję appki**
- **Headroom: 74 connections** — wystarczy na ~7 instancji horyzontalnie

**Brak pgbuncera.** Przy 100 klientach i jednej instancji — 13 połączeń w poolu jest wystarczające.

### 4.2 Redis

**128MB maxmemory, volatile-lru.** Obecnie: 1.31MB użyte.
- OAuth states (krótki TTL)
- Throttler counters (krótki TTL)
- Analytics cache (krótki TTL)
- **Wszystkie klucze mają TTL** — volatile-lru poprawne

Headroom: ~126MB. Dla 100 orgów — bezpieczne.

### 4.3 Temporal

**Namespace `default`, retencja 24h.** Workflowy na kolejce `main`.
- Pojedynczy worker process (orchestrator) obsługuje wszystkie platformy
- 32/32 workerów RUNNING (potwierdzone live)
- Przepustowość: worker przetwarza activity po activity. Dla 100 orgów publikujących jednocześnie — kolejka będzie rosła, ale worker nie padnie.

**RISK: MEDIUM** — retencja 24h na Temporal namespace. Zamknięte workflowy znikają po dobie. Główny sygnał błędu jest w `Post.error` w Postgres (backup obejmuje), ale historia Temporala jest nie-do-odzyskania po 24h. Już flagowane do owner.

### 4.4 Postgres

**384MB limit, 39MB użycie.** 100 orgów z typowym użyciem (po 50-100 postów, 5-10 kanałów):
- ~5000-10000 postów
- ~500-1000 integracji
- Indeksy na `organizationId` — wydajne dla per-tenant queries

**Plan limity per tier:**
| Tier | Kanały | Posty/miesiąc |
|------|--------|---------------|
| FREE | 0 | 0 |
| STANDARD | 5 | 400 |
| TEAM | 10 | ∞ |
| PRO | 30 | ∞ |
| ULTIMATE | 100 | ∞ |

Dla 100 klientów na STANDARD: 500 kanałów, do 40,000 postów/miesiąc — baza spokojnie udźwignie.

### 4.5 RAM

| Komponent | Limit | Użycie | Headroom |
|-----------|-------|--------|----------|
| postsider-app | 3072M | 1656M | 1416M |
| postgres | 384M | 39M | 345M |
| redis | 192M | 6M | 186M |
| temporal-es | 768M | 391M | 377M |
| temporal | 512M | 305M | 207M |
| minio | 256M | 61M | 195M |
| **Suma (limity)** | **~5300M** | **~2500M** | **~2800M** |
| **Host RAM** | **11G** | **6.2G** | **5.2G** |

Przy 100 klientach — postsider-app urośnie (więcej worker activity, więcej requestów), ale 1.4G headroomu wewnątrz kontenera + 5.2G na hoście daje margines.

### 4.6 Dysk

96G total, 51G użyte (53%), 46G wolne.
- MinIO: media klientów. Przy 512MB max upload i 100 orgach — może urosnąć.
- Backupy: 589M/dzień × 7 dni = ~4.1G.
- **Bez monitoringu przyrostu dysku — RISK: MEDIUM.**

### 4.7 Pojedyncze punkty awarii (SPOF)

| Komponent | SPOF? | Uwagi |
|-----------|-------|-------|
| VPS (host) | 🔴 TAK | Jeden fizyczny host OVH |
| Postgres | 🔴 TAK | Jedna instancja, brak replikacji |
| Redis | 🟡 TAK | Cache — awaria = degradacja, nie outage |
| MinIO | 🔴 TAK | Jeden bucket, wszystkie media klientów |
| Temporal | 🔴 TAK | Publishing stoi bez Temporala |
| Backupy | 🟡 TAK | Tylko lokalne, brak offsite |

---

## 5. PODSUMOWANIE I REKOMENDACJE

### 5.1 Czy 100 klientów może bezpiecznie korzystać?

**TAK, po załataniu CRITICAL i HIGH.** Aplikacja jest poprawnie zbudowana pod kątem multi-tenancy:
- Izolacja tenantów na poziomie middleware — sound
- Wszystkie tabele mają organizationId FK
- API ma rate limiting i plan enforcement
- Infrastruktura ma headroom na 100 klientów

**Ale znalezione nowe luki w warstwie repository (Temporal activities) i public endpointach
wymagają natychmiastowej naprawy przed otwarciem rejestracji.**

### 5.2 CRITICAL — blokery przed launch

1. **🔴 CRITICAL — GET /public/posts/:id cross-tenant data leak** (`public.controller.ts:67-88`).
   `makeId(10)` ID + `orgId` undefined w `getPostsRecursively` = KAŻDY post KAŻDEJ organizacji
   dostępny publicznie. Fix: share-token gate (`Post.sharableToken`) LUB auth middleware + orgId filter.
   **Ten endpoint musi być załatany przed publicznym uruchomieniem.**

2. **🔴 HIGH — Repository methods bez organizationId filter** (10 metod w `posts.repository.ts`
   i `integration.repository.ts`). Wołane z Temporal activities. `getPlug` wycieka tokeny OAuth.
   Fix: dodać `organizationId` do każdego `where`.

3. **🔴 HIGH — Offsite backup** — `rclone` do S3/B2. Pojedynczy VPS to SPOF dla wszystkich danych.

4. **🔴 HIGH — `DISABLE_REGISTRATION=true`** — rejestracja nigdy nie testowana end-to-end na produkcji.

5. **🟡 HIGH — checkPreviousConnections cross-org probing** — OAuth flow umożliwia enumerację tenantów.

### 5.3 MEDIUM — do zrobienia w ciągu miesiąca

6. **pgbouncer** przed Postgres — connection pool na skalowanie horyzontalne
7. **MinIO per-org quotas** — 100 orgów bez limitów storage = ryzyko wyczerpania dysku
8. **RLS na bazie** — defense-in-depth. Obecnie application-layer only.
9. **Webhook controller @CheckPolicies** — USER nie powinien zarządzać webhookami
10. **Monitoring dysku** — alert przy 80% użycia. Przy 100 klientach MinIO urośnie szybciej.
11. **Temporal retention 24h → 7-30 dni** — dla audytu i debugowania
12. **Walildacja POLAR_ACCESS_TOKEN przy starcie** — fail-fast zamiast unlimited dostęp
13. **TOCTOU race na channel count** — `SELECT ... FOR UPDATE` albo counter w Redis
14. **No CPU limits** — dodać cgroup limits przed 50+ orgami
15. **postsider-app 3072M limit** — przy 100 klientach orchestrator (max 2800M) + backend (max 1024M) = 3.8GB nominalnie w kontenerze 3GB. Rozważyć 4096M albo split orchestratora do osobnego kontenera.

### 5.4 LOW — backlog

16. `cuid()` → `uuid()` dla Post.id / Integration.id / Subscription.id (timestamp leakage)
17. Inconsistent naming `orgId` vs `organizationId` (Tags, Customer, UsedCodes)
18. Rate limit per-API-key zamiast per-org (dla public API)
19. Global throttle 9999/h → obniżyć
20. Brak kolumny `secret` w tabeli Webhooks (HMAC signing)
21. `GET /public/posts/:id/comments` — komentarze bez autoryzacji (potwierdzone product decision)
22. **Postgres password hardcoded fallback** w docker-compose (`postsider-secure-pwd-change-me`) — zmienić na `:?` error
23. **umami container bez memory limit** — `docker stats` pokazuje 11.4GB limit. Dodać `mem_limit` w `~/umami/docker-compose.yml`
24. **Deploy script rollback manualny** — dodać `--rollback` flag automatyzującą `docker tag :prev :latest`
25. **Deploy buduje na produkcji** — konkuruje o CPU/RAM z działającą apką. Rozważyć CI/CD (GitHub Actions runner)

### 5.5 Co już działa dobrze

- ✅ Auth middleware (JWT → DB re-resolve, `req.org` zawsze z własnych org usera)
- ✅ Schemat DB — 30/30 tabel z organizationId FK
- ✅ Wszystkie wcześniejsze HIGH fixy wdrożone (billing bypass, public API plan bypass, approval bypass, evergreen bypass, double-subscription, zombie billing, API keys fix)
- ✅ SSRF ochrona 3-warstwowa (validator + DNS-pinned dispatcher + IP blocklist)
- ✅ Rate limiting na auth (IP + email) + public API (per org)
- ✅ CSRF + cookie security (secure, httpOnly, sameSite, Origin/Referer allowlist)
- ✅ MinIO anon listing zablokowany (GetObject-only)
- ✅ Healthcheck trójwarstwowy (frontend:5000 + backend:/api/health + workers:/health/workers)
- ✅ Monitoring 12/12 kontenerów + Temporal pollers na `main` + stuck posts w QUEUE
- ✅ Backupy codzienne (03:30 UTC, n8n + PostSider full, rotacja 7 dni)
- ✅ UFW (tylko 22/80/443) + TLS (Let's Encrypt auto-renew) + HSTS + nosniff
- ✅ Container memory limits + non-root user (`USER postsider`)
- ✅ `NOT_SECURED` abort przy starcie w production
- ✅ Plan enforcement (Polar webhook + PermissionsService.check)
- ✅ Trial system (7-day STANDARD, one-per-email przez TrialUsage)
- ✅ Deployment z `:prev` rollback tagiem + health-gated
- ✅ Redis volatile-lru + wszystkie klucze z TTL
- ✅ Temporal startup race załatany (healthcheck, depends_on, retry/crash)

### 5.6 Co NIE zostało zweryfikowane (poza zasięgiem tej sesji)

- Rzeczywiste testy obciążeniowe (100 symulowanych klientów)
- Polar webhook — czy rzeczywiście dociera (nie było realnego webhooka od wdrożenia)
- UptimeRobot — zewnętrzny monitoring
- Email deliverability (contact@postsider.com przez Resend)
- DNS dla postsider.com (Netlify) vs app.postsider.com (VPS)
- LinkedIn reconnect (token revoked)
- GMB token refresh (własna org testowa)

---

*Audyt wykonany 2026-08-09 na żywym VPS (51.75.70.123). Dane z `docker stats`, `psql`, `redis-cli`, `journalctl` i przeglądu kodu (schema, middleware, guards, controllery).*
