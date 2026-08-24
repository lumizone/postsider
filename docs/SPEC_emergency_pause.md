# SPEC — Emergency Pause (Kill Switch)

Status: final (MVP, org-wide). Jedna prosta funkcja: **pause all** — jeden klik/endpoint
wstrzymuje całe publikowanie organizacji, z deterministycznym wznowieniem.

Zasada produktowa (nie negocjowalna): **pause może odpalić każdy (UI / public API /
webhook / MCP), resume zawsze robi człowiek (owner przez dashboard).** To jest "door
you control" — auto-pause przez monitoring (scenariusz 9) jest wspierany, ale powrót do
publikacji to świadoma decyzja, nigdy automat.

---

## 1. Model danych

### 1.1 Nowa wartość enumu `State`

`schema.prisma:837` — dodaj `HELD`:

```prisma
enum State {
  QUEUE
  PUBLISHED
  ERROR
  DRAFT
  APPROVAL
  HELD
}
```

### 1.2 Pola na `Organization` (`schema.prisma:11`)

```prisma
publishingState        PublishingState @default(ACTIVE)
publishingPausedAt     DateTime?
publishingPausedById   String?          // user id (bez FK — MVP), null gdy active
publishingPauseReason  String?
```

Nowy enum:

```prisma
enum PublishingState {
  ACTIVE
  PAUSED
}
```

(Jeden stan pauzy — bez `emergency_paused`. `active | paused`.)

### 1.3 Migracja

`libraries/nestjs-libraries/src/database/prisma/migrations/20260824000000_emergency_pause/`
(`migrate dev`). NIE `db push`. Enum `State` + enum `PublishingState` + 3 kolumny na
`Organization`. Default `ACTIVE` — istniejące orgi niezmienione.

---

## 2. Semantyka stanów

| `publishingState` | `type: now` | `type: schedule` | `type: draft` | odczyt | workflow (fire) | resume |
|---|---|---|---|---|---|---|
| `ACTIVE` | publikuje | uzbraja workflow | działa | działa | publikuje | — |
| `PAUSED` | **423** | **423** (nie tworzy posta) | działa (201) | działa | **HELD** | HELD → DRAFT (domyślnie) lub re-QUEUE |

- `HELD` = "był w QUEUE, ale zatrzymany przez pauzę". Widoczny w kalendarzu/posts
  z odrębnym badge. Nie publikuje sam.
- Pauza NIE anuluje posta już wysłanego do providera (in-flight) — best-effort od
  momentu przejścia w `PAUSED`; guard łapie na START (claim), nie cofa requestu.

---

## 3. API

### 3.1 Session (dashboard) — nowy kontroler

`apps/backend/src/api/routes/publishing.controller.ts`, `@Controller('/publishing')`,
rejestracja w `apps/backend/src/api/api.module.ts` (obok innych `authenticatedController`).

```
POST /publishing/pause          body { reason?: string }   → 200 { state, pausedAt, by, reason }   (idempotentne)
POST /publishing/resume         body { behavior?: 'to_draft'|'auto_resume' } → 200 { state, heldPostsProcessed }
GET  /publishing/state          → 200 { state, pausedAt, pausedBy, reason }
```

- `pause` / `resume`: **owner-only** — wzorzec `assertOwner()` z
  `billing.controller.ts:29` (`org.users?.[0]?.role !== 'SUPERADMIN'` → 403).
- `state`: dowolny członek org (role USER+).

### 3.2 Public API (key-auth) — scenariusz 9 (auto-pause)

`apps/backend/src/public-api/routes/v1/public.integrations.controller.ts` (albo nowy
kontroler obok) — base `/public/v1`:

```
POST /public/v1/publishing/pause     body { reason?: string }   → 200 { state, pausedAt, by, reason }
GET  /public/v1/publishing/state     → 200 { state, pausedAt, pausedBy, reason }
```

**Brak resume w public API** — resume = człowiek (dashboard), świadomie. Atrybucja
`pausedBy` przez `resolveApiRequester` (jak `ApprovalService.requestApprovalFromApi`).

### 3.3 Błąd 423

```
HTTP 423  { "error": "publishing_paused", "state": "paused", "reason": "..." }
```

- Nowy wyjątek `PublishingPausedException` (Nest `HttpException` ze statusem 423).
- **MUSI** ominąć istniejący `HttpExceptionFilter`, który remapuje
  `HttpForbiddenException` → 401 + czyści cookies (nie dotyczyć 423; nie wylogowuje).
- Zwracany w punktach A (tworzenie) i przez narzędzia publikujące.

---

## 4. Trzy punkty kontrolne

### A) Tworzenie posta

`PostsService.createPost(orgId, body, creationMethod)` (`posts.service.ts`) — na
początku (przed `mapTypeToPost`/walidacją kanałów, ale po resolucie org) sprawdź
`Organization.publishingState`:

- `PAUSED` i `body.type === 'draft'` → kontynuuj normalnie.
- `PAUSED` i `body.type ∈ { 'schedule', 'now' }` → rzuć `PublishingPausedException` (423).
  **Nie twórz posta** (deterministycznie odrzuć).

Dotykają tego obie ścieżki: `PostsController.createPost` (`posts.controller.ts:311`)
i `PublicIntegrationsController.createPost` (`public.integrations.controller.ts:242`)
— obie wołają ten sam `_postsService.createPost`, więc check w serwisie łapie obie.

Dodatkowo `changePostStatus` (`posts.service.ts:1218`) i `changeDate` (`:1261`): gdy
`PAUSED`, zablokuj przejście do `QUEUE` (423) — do `DRAFT` wolno.

### B) Odpalanie z kolejki (worker) — atomowo

**Nowa aktywność** w `PostActivity` (`apps/orchestrator/src/activities/post.activity.ts`):

```ts
@ActivityMethod()
async claimPostForPublish(orgId: string, postId: string) {
  return this._postService.claimPostForPublish(orgId, postId);
}
```

**Nowa metoda** `PostsService.claimPostForPublish(orgId, postId)` — w **transakcji Prisma**
(`this._postRepository... $transaction`, interaktywna), atomowo:

1. ładuje post (z `integration`, jak `getPost`) + `Organization.publishingState`;
2. jeśli `publishingState === 'ACTIVE'` → zwraca `{ outcome: 'publish', post }`;
3. jeśli `PAUSED`:
   - `post.state === 'QUEUE'` → `update state = HELD`, zwraca `{ outcome: 'held', reason }`;
   - inny stan (PUBLISHED/ERROR/DRAFT/APPROVAL/HELD) → `{ outcome: 'abort', reason }`
     (nie zmienia stanu — np. repeat-post już opublikowanego posta).

**Zmiana workflow** `post.workflow.v1.0.5.ts` (`post.workflow.v1.0.5.ts:82`):

- Zamień `const firstPost = await getPost(organizationId, postId)` na
  `const claim = await claimPostForPublish(organizationId, postId)`.
- `claim.outcome === 'held'` → log + `return` (bez `changeState ERROR` — stan HELD już
  ustawiony w transakcji).
- `claim.outcome === 'abort'` → `return` (bez publikacji, bez zmiany stanu).
- inaczej `const firstPost = claim.post` i reszta bez zmian.

Guard działa **niezależnie od `postNow`** (child `repeat-post` ma `postNow: true` i
pomija dotychczasowy check `state !== 'QUEUE'` — pauza musi łapać też tę gałąź).

**Sweep** `searchForMissingThreeHoursPosts` (`posts.repository.ts:38`) — dodaj do
`where` filtr `organization: { publishingState: 'ACTIVE' }`, żeby hourly safety net
**nie re-uzbrajał** HELD postów (inaczej `signalWithStart`+`poke` budzi workflow w pętli).

**`startWorkflow`** (`posts.service.ts:785`) — na początku `if (state === 'HELD') return;`
oraz nie uzbrajaj gdy org `PAUSED` (dla ścieżek zmiany daty/statusu, które docierają tu
poza create).

### C) Resume

`PostsService.resumePublishing(orgId, behavior)` — transakcja:

1. ładuje HELD posty org (`state: HELD, deletedAt: null`);
2. `Organization.publishingState = 'ACTIVE'`, czyści `publishingPausedAt/ById/PauseReason`;
3. `behavior === 'to_draft'` (domyślne): każdy HELD → `DRAFT`;
4. `behavior === 'auto_resume'`: HELD → `QUEUE` + `startWorkflow`; posty z
   `publishDate` w przeszłości → **zawsze** `DRAFT` (nigdy auto-publikuj mocno
   przeterminowanego) — reslot `findFreeDateTime` tylko dla przyszłych;
5. zwraca `{ state: 'active', heldPostsProcessed: N }`.

---

## 5. MCP (`apps/mcp/src/index.ts`)

Nowe narzędzia (wrapping public API):

```
postsider_pause_publishing(reason?: string)  → POST /public/v1/publishing/pause
postsider_get_publishing_state()             → GET  /public/v1/publishing/state
```

- **Brak `resume` w MCP** — resume jest human-only (dashboard). Agent może tylko
  zatrzymać i sprawdzić stan.
- `postsider_create_post` (index.ts:352): gdy backend zwróci 423, zwróć strukturalny
  błąd `publishing_paused` (żeby agent zrozumiał *dlaczego*), a nie goły `fail(e)`.
  `client.post` ma już błąd — dopisz mapowanie statusu 423 → czytelny message.

---

## 6. Powiadomienia in-app (obowiązkowe w MVP)

Reuse `NotificationService.inAppNotification` (podpis jak w `post.activity.ts:316`,
event `{ key, params }`) z dwoma nowymi `eventKey` (mapa `eventKey → MessageKey` w
notifications-bell, jawnie wypisana):

- `publishingPaused` — przy `pause` (do wszystkich ADMIN/SUPERADMIN).
- `publishingResumed` — przy `resume`.

Klucze i18n w `apps/frontend/src/lib/i18n/messages/en.ts` + `pl.ts` (pozostałe locale
fallback na EN, jak w konwencji).

---

## 7. Webhooki + audit log (v2, Pro — poza MVP)

- **Outbound webhook** `publishing.paused` / `publishing.resumed`: reuse istniejącego
  `Webhooks` modelu (`schema.prisma:676`) + `getWebhooksForDelivery` +
  `signWebhook` + `ssrfSafeDispatcher` (dokładnie jak `sendWebhooks` w `post.activity.ts:363`).
- **Audit log**: tabela `AuditLog` **już istnieje** (`schema.prisma:958`:
  `organizationId / operation / correlationId / status / type / inputHash / createdAt`).
  Wpisy `emergency_pause`, `resume_publishing`, `post_held` — tylko dopisać w serwisie.

---

## 8. UI (dashboard)

- `apps/frontend/src/components/dashboard-shell.tsx` — topbar/org settings: czerwony
  przycisk "⏸ Emergency pause" (owner/admin) + modal (pole "Dlaczego?" + potwierdzenie).
  Gdy `paused`: baner na cały dashboard "Publishing PAUSED — [reason] · Resume"
  (resume z wyborem to_draft / auto_resume, owner-only).
- Composer `create-post-modal.tsx` — obsługa 423 jako strukturalny błąd (nie goły).
- Kalendarz — badge/status `HELD` (kolor pomarańcz/szar + tooltip), wyklucz z
  `isDraggableStatus()` (wzorzec z approval).
- `apps/frontend/src/lib/api` — 423 **nie** wylogowuje (jak 403); helper
  `api.get('/publishing/state')` etc.

---

## 9. Checklist dla buildera (mapa plików)

| # | Plik | Zmiana |
|---|---|---|
| 1 | `libraries/.../schema.prisma` | enum `State` +`HELD`, enum `PublishingState`, 3 kolumny `Organization` |
| 2 | `libraries/.../migrations/20260824000000_emergency_pause/` | migracja |
| 3 | `libraries/.../organization/organization.repository.ts` (+service) | `getPublishingState`, `setPublishingState`, `findHeldPosts` |
| 4 | `libraries/.../posts/posts.service.ts` | `createPost` guard 423, `claimPostForPublish` (transakcja), `resumePublishing`, blokady `changePostStatus`/`changeDate` |
| 5 | `libraries/.../posts/posts.repository.ts` | `searchForMissingThreeHoursPosts` +`organization.publishingState: 'ACTIVE'`, helper HELD |
| 6 | `libraries/.../posts/posts.service.ts:785` | `startWorkflow` guard HELD/PAUSED |
| 7 | `apps/orchestrator/src/activities/post.activity.ts` | `claimPostForPublish` |
| 8 | `apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.5.ts:82` | użyj `claimPostForPublish`, obsługa `held`/`abort` |
| 9 | `apps/backend/src/api/routes/publishing.controller.ts` | nowy kontroler (session), `assertOwner` |
| 10 | `apps/backend/src/api/api.module.ts` | rejestracja kontrolera |
| 11 | `apps/backend/src/public-api/routes/v1/...` | `POST /public/v1/publishing/pause`, `GET .../state` |
| 12 | `apps/backend/src/.../http.exception.filter.ts` (lub gdzie remap 401) | `PublishingPausedException` → 423, poza remapem 401 |
| 13 | `apps/mcp/src/index.ts` | `postsider_pause_publishing`, `postsider_get_publishing_state`, map 423 w `create_post` |
| 14 | `apps/frontend/src/lib/api` + `notifications-api.ts` | endpointy + brak logout na 423 |
| 15 | `apps/frontend/src/components/dashboard-shell.tsx` | przycisk + baner + modal |
| 16 | `apps/frontend/src/components/create-post-modal.tsx` | obsługa 423 |
| 17 | kalendarz (`calendar.tsx` / status render) | badge HELD + `isDraggableStatus` |
| 18 | `apps/frontend/src/lib/i18n/messages/{en,pl}.ts` | klucze (UI + eventKeys `publishingPaused`/`publishingResumed`) |

## 10. Weryfikacja

- `pnpm run build:backend`, `pnpm run build:orchestrator`,
  `pnpm --filter ./apps/frontend run build`, `pnpm test`.
- Testy: transakcyjność `claimPostForPublish` (race pauza↔claim), deterministyczny 423
  na `now`/`schedule`, `draft` działa przy PAUSED, resume `to_draft` vs `auto_resume`
  (przeterminowane → DRAFT), sweep nie re-uzbraja HELD, 423 nie wylogowuje na froncie.
- Deploy: `cd /home/ubuntu/postsider_app && sudo ./deploy.sh` (health-gated).
