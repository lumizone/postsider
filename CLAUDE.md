# PostSider Cloud (PostSider_APP)

The PostSider product app (NestJS backend + Next 15/React 19 frontend + Temporal orchestrator, pnpm monorepo, Postiz fork). **This is now the single open-source repo** (AGPL-3.0) for both our managed hosting (`app.postsider.com`) and self-hosting via Docker, switched entirely by env vars (see "Run modes" below).

## Zasada produktowa (nie negocjowalna)

PostSider jest produkcyjnym SaaS-em z klientami. **Publikacja musi działać w pełni
automatycznie, na publiczne konta, bez żadnego ręcznego kroku po stronie użytkownika.**
Tryby wymagające dokliknięcia (szkice/inbox TikToka `content_posting_method: UPLOAD`,
posty prywatne, „opublikuj sam w apce") NIE są rozwiązaniem i nie wolno ich proponować
ani wdrażać jako obejścia. Gdy blokuje platforma (audyt/review), jedyna droga to zdjęcie
blokady u źródła — złożenie audytu, materiały do review, zgodność kodu z wymaganiami.

## Status

- **Dark theme — cała aplikacja (2026-08-25, WDROŻONE 13:49).**
  Commity `38df951` (motyw) + `ad80d78` (audyt widoczności + fix hydracji).
  Backup przed-deployowy: `postsider_backups/predeploy-20260825-134910`,
  rollback: obraz `postsider_app-postsider:prev`. Po deployu potwierdzone
  na żywo: 12/12 kontenerów, `/api/health` redis+database+temporal ok,
  pollery na kolejce `main` (workflow+activity, backlog 0), pm2 3/3 online
  z 0 restartów, `storage.postsider.com/image/<plik>` → 200 (regresja nginx),
  5 endpointów 200, timery ×5 active. **Skrypt motywu w serwowanym HTML
  siedzi ZA `</head>`, czyli w `<body>`** — dowód, że fix hydracji wszedł.
  Playwright na żywej produkcji: `firstPaint=dark` dla stored-dark
  i system-dark, `light` dla stored-light, zero błędów konsoli.
  Trzy stany: Light / Dark / System (`postsider:theme` w localStorage, jak
  `postsider:locale`). Przełącznik słońce/księżyc w stopce sidebara i w pasku
  mobilnym (`theme-toggle.tsx`), trójstanowy wybór w Settings → General
  („Appearance"), klucze i18n `theme.*` w en+pl. Backend i baza nietknięte.
  - **Kontrakt tokenów (`globals.css`) — trzymać się go w nowym kodzie:**
    `--page` maluje TYLKO `<body>`, `--bg` to każdy panel/karta/input/modal.
    W jasnym oba są białe (zero zmian wizualnych), w ciemnym `--bg` (#141416)
    jest o stopień jaśniejsze od `--page` (#08080a) — i to jedyne, co odkleja
    kartę od tła. Dzięki temu 97 istniejących `background: var(--bg)` dostało
    elewację bez dotykania modułów.
  - **`--tint` zamiast `rgba(0,0,0,α)`.** Każda półprzezroczysta nakładka to
    `rgb(var(--tint) / α)`; jasny tintuje czernią, ciemny bielą, więc jedna
    alfa daje tę samą wagę względną w obu motywach. **Nie pisać literalnego
    `rgba(0, 0, 0, α)`** — przerobione 142 wystąpienia w CSS + reszta w inline
    style. Wyjątki: `--shadow` (cienie zostają czarne, w ciemnym alfa ×
    `--shadow-boost`, bo czarny blur na ciemnym tle znika) i `--scrim`
    (backdropy modali, czarne w obu motywach).
  - Do tego `--on-fg`/`--on-fg-rgb` (treść na powierzchni malowanej `--fg`),
    `--danger`/`--warning`/`--success`/`--info` + warianty `-soft`/`-strong`/
    `-bright` (w ciemnym podniesione, bo jasne tusze nie przechodzą kontrastu
    na ciemnym tle) i `--accent` (fiolet głównej karty analytics).
  - **Brak migotania.** `THEME_INIT_SCRIPT` (w `lib/theme.tsx`, wstrzykiwany
    do `<head>` w `layout.tsx`) stempluje `data-theme` na `<html>` przed
    pierwszym malowaniem; `<html suppressHydrationWarning>` bo serwer tego
    atrybutu nie zna. **Pułapka złapana w testach:** efekt zapisujący
    `data-theme` odpalał się z placeholderem `light` z pierwszego renderu i
    nadpisywał to, co skrypt poprawnie namalował — użytkownik „System" na
    ciemnej maszynie dostawał błysk na biało. Stąd flaga `ready`: React nie
    tyka atrybutu, dopóki nie odczyta prawdziwej preferencji.
  - Zweryfikowane Playwrightem (Chrome 133 z cache, mock API): 18 tras ×
    2 motywy × desktop 1440×900, zero poziomego overflow, zero błędów
    konsoli/hydracji; modale (kompozytor, dzwonek, DayPopup); mobile 390×844;
    persystencja i podążanie za `prefers-color-scheme` na żywo; pierwszy
    paint poprawny w 4 kombinacjach (stored/system × light/dark).
    **Audyt kontrastu WCAG AA na wszystkich trasach: ciemny nie wprowadza
    ANI JEDNEJ nowej porażki** — każde trafienie ma bliźniaka w jasnym o tym
    samym lub gorszym współczynniku (monogramy awatarów na kolorach marek,
    wygaszone dni spoza miesiąca). Przy okazji wyszło, że **„Danger zone"
    w JASNYM motywie ma 4.29 przy wymaganych 4.5** (stare, nie ruszone).
  - 168/168 testów zielone, `tsc --noEmit` czysty, `next build` czysty.
  - **Audyt głęboki (2026-08-25, druga tura) — 44 widoki × 2 motywy, 16 355
    porównanych elementów.** Metoda: ten sam widok renderowany w obu motywach,
    `getComputedStyle` diffowany element po elemencie (`color`, `background`,
    `border*`, `fill`, `stroke`, `boxShadow`, `outline`). Wartość IDENTYCZNA
    w obu motywach = kolor, który nie podąża za motywem. Skrypty w scratchpadzie
    sesji (`deep-audit.js`, `mocks.js`, `states.js`, `hydra.js`, `noflash.js`).
    Znalazło cztery rzeczy, których nie widać na zrzutach:
    - **BŁĄD HYDRACJI, który sam wprowadziłem.** Ręczny `<head>` z inline
      `<script>` w `layout.tsx`: App Router hoistuje `<script>` z ręcznego
      `<head>`, więc serwowany HTML rozjeżdżał się z drzewem po hydracji —
      **React #418 na 8–9 z 15 wejść, w OBU motywach**. Baseline (commit sprzed
      dark theme, przebudowany i zmierzony tym samym skryptem) miał 0/15.
      Fix: skrypt jest teraz **pierwszym dzieckiem `<body>`**, bez ręcznego
      `<head>` — wykonuje się, gdy body dopiero się parsuje, czyli nadal przed
      pierwszym malowaniem. Po poprawce 0/15 w obu motywach, a pierwszy paint
      dalej poprawny w 4/4 kombinacjach. **Zasada: nie renderować ręcznego
      `<head>` w `app/layout.tsx`.**
    - **Hover w całej apce to „uniesienie cieniem", a cień jest czarny** —
      na ciemnym tle nie istnieje. W czterech miejscach reguła hover dodatkowo
      robiła `border-color: transparent`, więc w ciemnym najechanie sprawiało,
      że element **tracił** krawędź. Token `--lift-ring` (jasny: `transparent`,
      czyli zero zmian; ciemny: `rgb(255 255 255 / 0.16)`) doszedł jako
      `inset 0 0 0 1px` do 11 reguł hover oraz w miejsce `transparent`
      w `border-color`. Zweryfikowane na 6 powierzchniach × 2 motywy.
    - **Kolor kanału to dane, więc nie może podążać za motywem** — paleta
      `CHANNEL_COLOR_PALETTE` zaczyna się od „Ink" `#0F0F0F`, czyli w ciemnym
      niewidoczny dysk awatara, kropka kanału i próbka w modalu. Wszystkie trzy
      dostały `inset 0 0 0 1px rgb(var(--tint) / 0.18–0.22)`.
    - **Kafelki marek w „Add channel"** (`SVG_FALLBACKS` w `platform-icon.tsx`)
      — Ghost `#15171A` ginął w ciemnym, a Notion i Mataroa `#fff` ginęły
      w JASNYM (**stary błąd, nie z tej sesji**). Ten sam hairline naprawia oba.
    - Reszta trafień to świadome decyzje: wygaszone dni spoza miesiąca
      (w jasnym mają GORSZY kontrast), monogramy awatarów na kolorach marek
      (identyczne w obu) i jeden przycisk `disabled` (WCAG 1.4.3 nie obejmuje).
      Domyślny `border-color: gray` tabeli analytics ma `border-width: 0` —
      fałszywy alarm detektora.
    - Stany `:hover`/`:focus-visible` zmierzone na 15 typach kontrolek: każda
      ma widoczną reakcję w ciemnym (outline `--fg`, tint tła albo `--lift-ring`).

- **UI: powiadomienia, filtry postów, przegląd całego dashboardu, polskie tłumaczenia
  (2026-08-25). CZĘŚCIOWO WDROŻONE.** Cztery commity na `fix/publish-pipeline-and-report-bugs`,
  branch **4 commity przed `origin`, nic nie wypchnięte**. **Na prodzie jest TYLKO
  `79e8c40`** (deploy 09:47, backup `postsider_backups/predeploy-20260825-094733`);
  `b17c323`, `cc7cbf0` i `c5bd007` są wyłącznie w gicie lokalnym.
  - **`79e8c40` (WDROŻONE) — powiadomienia.** `GET /notifications/page` +
    strona `/notifications` (pełna historia za „zobacz wszystkie" w dzwonku;
    strona 0 oznacza przeczytane i zwraca POPRZEDNI znacznik, głębsze strony
    nie ruszają znacznika, więc podświetlenie „nowe" nie znika przy stronicowaniu).
    Wspólny renderer (nagłówki dni, czas względny, waga zdarzenia z `eventKey`)
    dla panelu i strony. **Przycisk akcji zgodny z linkiem:** opublikowany post
    ma „Zobacz post" i otwiera URL platformy w nowej karcie, błędy mają „Napraw",
    wiersz bez linku nie ma przycisku. Wcześniej `toRelative()` przepisywał KAŻDY
    link spoza naszego origin na `/calendar`, więc udana publikacja oferowała
    „Napraw" i wyrzucała na kalendarz, a powiadomienia o NIEUDANEJ publikacji
    nie miały linku w ogóle — fallback (`/calendar`) dodany w
    `NotificationService.DEFAULT_EVENT_LINKS`, **nie w workflow Temporala**
    (workflowu nie wolno edytować w miejscu). Dzwonek: podświetlenie nowych
    z `lastReadNotifications` (pole było zwracane i wyrzucane), bottom sheet
    poniżej 600 px, focus trap, czyszczenie org-wide za potwierdzeniem, plakietka
    gaśnie od razu po wejściu na stronę (event `postsider:notifications-read`).
  - **`b17c323` + `cc7cbf0` (NIE wdrożone) — filtry i sortowanie postów.**
    Filtr po kanale i zakresie dat (presety + własny), kontrolka sortowania.
    **Domyślne sortowanie: „Najpierw opublikowane"** (opublikowane od najnowszego
    na górze, pod spodem stara kolejność wymagających uwagi). Liczniki na
    zakładkach statusów liczą się PO filtrach. Pigułka statusu nie wychodzi już
    poza kolumnę i nie drukuje się na tytule (`.list` trzyma kolumny, wiersz
    bierze je przez `subgrid`, fallback `max-content`); wąski ekran daje pigułce
    własną linię, a pasek zakładek scrolluje się w swoim boksie. Klucz
    `posts.emptyFiltered` istniał od dawna i nigdy nie był użyty.
    **Ograniczenie:** filtrowanie jest klientowe po ≤500 postach na stan
    (`fetchPostsList` nie przyjmuje zakresu dat ani kanału).
  - **`c5bd007` (NIE wdrożone) — audyt UI całej apki + polski katalog.**
    23 trasy × desktop 1440×900 i telefon 390×844, mockowane API. Naprawione:
    `/settings/queue-plan` wpychał stronę w poziomy scroll (email bez spacji
    w wierszu przypisania — JEDYNA trasa z overflow), **12 pól < 16 px**
    (iOS zoomuje viewport i nie wraca) załatwione jedną regułą w `globals.css`
    + 3 miejsca bijące ją klasą/inline, cele dotykowe 28–30 px podniesione do 36
    (segmenty przez `[role="tab"]`, menu wiersza, przełączniki, dni tygodnia,
    checkboxy 13→18 px, „?" dostał niewidoczne pole 32 px), `aria-label` na polu
    godziny, `data.clients?.find` w `AgencyDashboard` (payload bez `clients`
    zamieniał stronę na surowy TypeError). **Polski katalog: 179 brakujących
    kluczy** (EN 1075, PL 896) — całe obszary leciały po angielsku: Overview,
    ustawienia organizacji, zużycie AI, szczegóły postu, checklist, przełącznik
    organizacji, info-tipy i **ekran recenzji dla klienta zewnętrznego**.
    Uzupełnione, parzystość `{placeholderów}` zweryfikowana. Podtytuł planu
    kolejki twierdził, że godziny są w UTC, choć strefa jest per kanał.
    Pozostałe 9 locale ma po 323 braki i dalej leci fallbackiem na angielski.
  - **Jak to było sprawdzane (do powtórzenia).** Prawdziwy Chrome + Playwright
    przeciwko `next dev` na :4300 z `NEXT_PUBLIC_BACKEND_URL=/api` i pełnym
    mockiem API przez `page.route('**/api/**')` — bez dotykania produkcji i bez
    kont testowych. Skrypty: `scratchpad/ui-audit.js` (przemiał tras),
    `ui-check.js`, `ui-check2.js`. **Dwie pułapki środowiskowe:**
    (1) `pnpm --filter ./apps/frontend run build` nadpisuje ten sam katalog
    `.next`, z którego żyje działający dev server — dev zaczyna serwować 404 na
    własne chunki i 500 na stronę; ubić dev, `rm -rf .next`, wystartować od nowa;
    (2) **Playwright 1.60 odmawia instalacji przeglądarek na Ubuntu 26.04**,
    a pobieranie z CDN jest z tego hosta zablokowane (400/403) — użyty
    cache'owany Chrome 133 z `~/.cache/puppeteer/chrome/linux-133.0.6943.141/`
    przez `chromium.launch({ executablePath })`.

- **Calendar: pionowe skalowanie MonthView (2026-08-24, WDROŻONE).** Commit
  `a148953` na `fix/publish-pipeline-and-report-bugs`; pełny `sudo ./deploy.sh`
  przeszedł, backup pre-deploy: `postsider_backups/predeploy-20260824-173006`.
  MonthView ma zamknięty łańcuch flex (`shell` → `root` → `monthWrap` → `grid`),
  więc sześć wierszy rozdziela dostępną wysokość zamiast wymuszać 140 px na
  kafelek. Desktopowe komórki płynnie schodzą do 42 px; niższy viewport używa
  scrolla panelu zamiast obcinać interakcje. Mobile zachowuje naturalny scroll,
  52 px touch target i brak poziomego overflow. Zmiana wysokości jest ograniczona
  do `/calendar`, więc nie zmienia layoutu innych ekranów dashboardu. Sprawdzone
  Playwright: desktop 1000/900/800/700 px → komórki 97/81/64/47 px; mobile
  390×800 → 52 px, bez horizontal overflow. Po deployu: `/calendar` 200,
  `/api/health` Redis/PostgreSQL/Temporal OK, workery 32/32 healthy; nowy kod
  potwierdzony w obrazie. Commit jest lokalny, `origin/fix/publish-pipeline-and-report-bugs`
  pozostaje 1 commit za nim (nie pushowano, bo polecenie obejmowało tylko commit+deploy).

- **Incident: edycja running workflowu Temporala = awaria publikacji (2026-08-24, NAPRAWIONE).**
  Monitor `vps-bd41b901` krzyknął „2 post(ów) wisi w QUEUE >30 min po terminie bez błędu".
  Workerzy 32/32 healthy, kanały i org zdrowe — to nie była awaria workerów.
  **Root cause:** gate Emergency Pause (`claimPostForPublish`) został dodany **w miejscu**
  funkcji `postWorkflowV105`, a nie jako nowa wersja. Workflowy wystartowane PRZED deployem
  miały historię `getPost → sleep`; nowy kod produkował `getPost → claimPostForPublish → sleep`
  → przy wybudzeniu timera **niedeterministyczny replay** → `WorkflowTaskFailed` w pętli.
  Posty zostawały w QUEUE bez błędu (dokładnie sygnatura „bez błędu"). **Skala:** ~30 running
  V105 (1–5 dni wstecz); 2 miały termin dziś 12:00.
  **Fix (wdrożony 12:47):** `postWorkflowV105` przywrócone do oryginału, gate przeniesiony do
  nowego `postWorkflowV106`; `startWorkflow` + sweep `missing-post` celują w V106. Stare V105
  replayują deterministycznie; nowe posty idą przez V106. 2 utknięte posty: IG wyleczył się sam,
  X — terminate osieroconego workflowu + ręczne uzbrojenie V106 (`temporal workflow start`).
  Commity: `9d0465d` (feature), `9fe8f6e` (fix wersjonowania). Oba na `fix/publish-pipeline-and-report-bugs`.
  **Lekcja (zasada na zawsze):** zmiana logiki workflowu Temporala = ZAWSZE nowa wersja
  (V105 → V106), NIGDY edycja istniejącej funkcji — running workflowy replayują się wobec
  kodu z momentu startu.

- **Powiadomienia w aplikacji: dzwonek, tłumaczenia, czyszczenie (2026-08-22, WDROŻONE).**
  Migracja `20260822120000_notification_event_key` zastosowana na prodzie 14:16.
  - **Backend zapisywał powiadomienia od zawsze, ale UI ich nie miało.** W bazie
    leżały **102 wpisy, których nikt nigdy nie zobaczył** — w tym alert
    „reconnect YouTube" z 21.08. Jedynym kanałem dostarczania był mail, a domena
    w Resend była niezweryfikowana od czerwca, więc komunikacja z użytkownikiem
    faktycznie nie istniała. Doszedł `notifications-bell.tsx` (stopka sidebara
    + pasek mobilny), licznik nieprzeczytanych odpytywany co 60 s, lista przy
    otwarciu. **Uwaga: `GET /notifications/list` oznacza wszystko jako
    przeczytane po stronie serwera** — dlatego polling pyta wyłącznie o licznik,
    inaczej plakietka kasowałaby się w tle.
  - **Panel był przycinany.** 320 px panelu w kolumnie sidebara szerokiej
    260 px, zakotwiczony do prawej → wychodził poza lewą krawędź okna. Teraz
    `createPortal` na `<body>` + pozycja liczona z `getBoundingClientRect`
    i dociskana do widoku (`placePanel`), otwieranie w górę lub w dół zależnie
    od miejsca. Wykrywanie kliknięcia poza panelem musiało objąć też portal —
    bez tego każde kliknięcie w listę ją zamykało.
  - **Tłumaczenia.** `Notifications.eventKey` + `eventParams` (JSON) obok
    dotychczasowego `content`. Backend nadal renderuje angielski `content` (idzie
    mailem i jest awaryjny dla starych wierszy), a panel renderuje 8 zdarzeń
    z i18n w języku klienta. Mapa `eventKey → MessageKey` jest **wypisana
    jawnie**, żeby TypeScript pilnował istnienia komunikatów.
  - **Martwy link naprawiony.** Alert o reconnectcie wysyłał klienta na
    `${FRONTEND_URL}/launches` — trasa z Postiza, **w PostSiderze nie istnieje**,
    czyli 404 na jedynej instrukcji naprawy. Teraz `/calendar`. Komunikat podaje
    też nazwę kanału, nie samo `providerIdentifier` (klient agencyjny z trzema
    kontami YouTube nie wiedział, które padło). Kolumna `link` była w modelu od
    początku i **nikt jej nigdy nie zapisywał** — teraz wypełniana, a dzwonek
    renderuje przycisk „Napraw"; linki spoza naszej domeny są odrzucane
    (`toRelative`).
  - **`DELETE /notifications`** — miękkie czyszczenie listy (org-wide, bo lista
    jest wspólna dla organizacji). Przy okazji `getNotifications` filtruje
    `deletedAt: null`, tak jak licznik (wcześniej rozjazd).

- **Analityka Facebooka nie zbierała się WCALE (2026-08-22, WDROŻONE).**
  W logach `(#100) The value must be a valid insights metric`. Sprawdzone na
  żywym tokenie, metryka po metryce: **`post_impressions_unique`,
  `post_impressions`, `post_impressions_organic` i `post_engaged_users` są przez
  Metę wycofane**; działają `post_reactions_by_type_total`, `post_clicks`,
  `post_clicks_by_type`, `post_activity_by_action_type`, `post_video_views`.
  Wszystkie leciały w JEDNYM zapytaniu, więc jedna wycofana wywalała całość →
  zero zaangażowania w panelu i zera w raportach PDF klientów. Fix:
  `POST_INSIGHT_METRICS` tylko ze zweryfikowanych + `fetchPostInsights()` przy
  odrzuceniu paczki pyta o każdą osobno i zachowuje to, co działa — następne
  wycofanie przez Metę pogorszy liczby zamiast je wyzerować.

- **Odświeżanie tokenów: audyt + sprzątanie (2026-08-22, WDROŻONE).**
  - Rozłączony kanał **nie przestawał odświeżać tokenów** — `refreshTokenWorkflow`
    jest per kanał i sam się zapętla, a nic go nie zatrzymywało. Na prodzie
    biegło 18 workflowów przy 10 żywych kanałach: 7 dla usuniętych, **4 dla
    integracji nieistniejących już w bazie**. `deleteChannel` terminuje teraz
    `refresh_<id>`; 11 sierot zatrzymanych ręcznie, zostało 7 (potem 8 po
    reconnectcie YT).
  - `deleteChannel` czyści też `token`/`refreshToken`/`tokenExpiration` —
    wcześniej rozłączony kanał zostawiał w bazie **ważny token**. Reconnect
    ożywia wiersz świeżymi tokenami, więc nic na tym nie traci.
  - Trasa enterprise `/delete-channel` nadal kasowała posty (fire-and-forget,
    błędy połykane) — usunięte, idzie przez `deleteChannel` jak reszta.
  - **Dowód na żywo, że auto-odświeżanie działa:** YouTube po reconnectcie
    odświeżył się sam o 14:21:19 (plan 14:21:18), wygaśnięcie 14:26 → 15:21,
    workflow ustawił kolejny timer 3238 s. Token dostępowy Google **zawsze** żyje
    godzinę — to norma platformy, nie awaria; użytkownik podłącza kanał raz.

- **Awaria mediów + reconnect + kasowanie kanału (2026-08-20). WDROŻONE 2026-08-21/22.**
  Working tree na branchu `fix/publish-pipeline-and-report-bugs`.
  - **Publikacje X/Instagram padały nie z winy PostSidera.** `unattended-upgrade`
    06:55 UTC podbił nginx hosta do `1.28.3-2ubuntu1.9`, w której `rewrite ... $1`
    gubi ostatni znak URI — `storage.postsider.com` zwracał 404 na każdy plik,
    więc X i Meta nie mogły pobrać mediów („Unknown Error", „Instagram media not
    ready", „Media fetch failed"). Naprawione host-side (szczegóły i zasada
    „żadnych `rewrite $1` w nginx" w `~/CLAUDE.md`). **Wniosek dla kodu: komunikat
    providera o mediach zawsze warto zweryfikować `curl`em na publiczny URL —
    ścieżka storage jest poza aplikacją.**
  - **Reconnect kanału był całkowicie zepsuty (409 `{"msg":"Channel not found"}`).**
    Dashboard wysyła `?refresh=<Integration.id>`, backend wkładał tę wartość do
    Redisa 1:1, a `reConnect(id, requiredId, token)` porównuje `requiredId` z
    idami zwracanymi przez `pages()` platformy, czyli z `internalId`. Nic nigdy
    nie pasowało — YouTube „Channel not found", i tak samo każdy inny provider
    z `reConnect` (to dlatego reconnect Facebooka tworzył NOWY wiersz zamiast
    odświeżyć istniejący). Fix: `resolveRefreshInternalId()` w
    `integrations.controller.ts` tłumaczy id org-scoped na `internalId`
    (nieznana wartość przechodzi bez zmian, więc callerzy podający już
    `internalId` działają dalej).
  - **Odłączenie kanału kasowało wszystkie jego posty — łącznie z historią
    PUBLISHED.** Reconnect Facebooka 19.08 zabrał tak 10 zaplanowanych postów.
    `IntegrationService.deleteChannel` parkuje teraz nieopublikowane posty
    (`QUEUE`/`ERROR`/`APPROVAL` → `DRAFT`) zamiast je kasować — workflow
    publikuje wyłącznie ze stanu `QUEUE`, więc szkic nie wystrzeli, a treść
    zostaje do przepięcia. Parkowanie siedzi w serwisie, więc łapie wszystkie
    ścieżki (dashboard, public API, „disconnect all" w ustawieniach). Teksty
    potwierdzeń en/pl poprawione (już nie straszą kasowaniem postów).
    **Uwaga: to zmiana udokumentowanego zachowania public API**
    (`DELETE /integrations/:id` już nie kasuje postów — od tego jest
    `DELETE /posts/:group`).
  - **Reconnect KASOWAŁ refresh token (2026-08-21).** W `no.auth.integrations.controller.ts`
    ścieżka reconnectu robiła `res({ ...newAuth, refreshToken: body.refresh })`.
    `reConnect()` nie zwraca żadnych poświadczeń (tylko rozstrzyga, którą stronę/kanał
    wybrano), a `body.refresh` to flaga od klienta („to jest reconnect"), nie token —
    więc każdy reconnect zapisywał **pusty** refresh token. Kanał działał do wygaśnięcia
    access tokena, potem umierał na `No refresh token is set.`, a jedyne „lekarstwo"
    (reconnect) kasowało go ponownie. Teraz bierzemy `auth.refreshToken` + `auth.expiresIn`
    z wymiany OAuth. **Ofiary na produkcji:** YouTube `cmsj94tzh…` (connect 08-07, padł
    08-20 18:00) i Discord „Local Waifu" `cmskdtwve…` (08-08, `refreshNeeded` od 15.08 —
    to NIE było odrzucenie tokenu przez Discorda, jak wcześniej zapisano). Oba wymagają
    reconnectu **po** deployu tej poprawki, inaczej znowu zapiszą pusty token.
  - **AI (Post Checker + rewrite) przeniesione na PLATFORMOWY DeepSeek (2026-08-21).**
    Wcześniej klucz DeepSeeka siedział tylko jako BYO jednej organizacji
    (`ProviderCredentials`, provider `post-checker`, model `deepseek-v4-flash`,
    zapisany 29.06) — czyli każdy nowy klient dostawał 409 „No AI key configured".
    Ten sam klucz wpisany do `.env.production` jako `AI_PROVIDER=deepseek` /
    `AI_API_KEY` / `AI_MODEL=deepseek-v4-flash`; kontener przecreowany z
    `--env-file`. Zweryfikowane na żywo: `isPlatformAiEnabled() = true`,
    provider `deepseek`. Limity: `pricing.ts ai_uses_per_month` (FREE 0,
    STANDARD 50, TEAM 150, PRO 500, ULTIMATE/SAMURAI 1000). Backup env:
    `.env.production.bak-pre-ai-*`. **Uwaga: `deepseek-v4-flash` to model
    rozumujący** — zużywa tokeny na `reasoning_content` przed treścią;
    sprawdzone realnym wywołaniem, że limity `CHECK_MAX_TOKENS=400` /
    `REWRITE_MAX_TOKENS=600` wystarczają (`finish_reason: stop`), ale przy
    dłuższych promptach to pierwsze miejsce do podniesienia.
    `OpenaiService` jest wstrzykiwany w modułach, ale **nigdzie nie wywoływany**
    — martwe okablowanie po Postizie, cała AI leci przez `PostCheckerService`.
  - **TikTok `video.list` przywrócony** po zatwierdzeniu scope (wpis niżej).
  - **Kompozer TikToka przerobiony pod audyt Content Posting API.** App „Live"
    nie zdejmuje blokady `unaudited_client_can_only_post_to_private_accounts` —
    sprawdzone na żywym tokenie: błąd leci również przy `SELF_ONLY`, bo dotyczy
    *konta* (publiczne), nie `privacy_level`. Audyt ocenia UI, więc doszło:
    `TiktokProvider.creatorInfo()` (`@Tool`, wołane przez `/integrations/function`)
    → opcje prywatności wyłącznie z `privacy_level_options`, **nic nie jest
    wstępnie zaznaczone** (post bez wyboru nie przejdzie walidacji), duet/stitch/
    komentarze wyszarzone wg `*_disabled`, treść komercyjna nie może być
    `SELF_ONLY`, widoczne Music Usage Confirmation + Branded Content Policy
    i etykieta „Promotional content"/„Paid partnership". Nowe pola
    `dynamicOptions`/`dynamicDisabled` w `SettingsField`. Klucze i18n
    `createPost.tiktok.*` (en+pl). **Zostało po stronie właściciela:** złożyć
    wniosek o audyt Direct Post + demo video, zweryfikować domenę
    `storage.postsider.com` dla PULL_FROM_URL w portalu.
  - **Ręczne naprawy danych na prodzie (SQL).** 8 postów FB przepiętych ze
    zmarłego kanału `cmsj634320003tj2hu9ehyjt0` na żywy
    `cmszfdi8x000drv2kwmfk9lhy` — publikują poprawnie od 21.08. 6 postów X/IG/FB,
    które padły przez awarię nginx, przekolejkowanych na 27–28.08.
    **Uwaga na przyszłość: sam `UPDATE` stanu na `QUEUE` NIE wystarczy** —
    publikacją steruje workflow Temporala, a `missingPostWorkflow` łapie
    wyłącznie posty z datą w PRZESZŁOŚCI. Post z przyszłą datą trzeba uzbroić
    ręcznie: `postWorkflowV105`, `workflowId: post_<id>`, `taskQueue: 'main'`,
    args `{ taskQueue: <provider>, postId, organizationId }` + atrybuty
    `postId`/`organizationId`, `TERMINATE_EXISTING`.

- **Cicha-awaria bug hunt: 9 defektów znalezionych przez audyt DZIAŁAJĄCEJ produkcji
  względem kodu (2026-08-19).** Commit `2c7c729` na branchu
  `fix/publish-pipeline-and-report-bugs` (15 plików, **NIE zmergowany do `main`,
  NIE wypchnięty na origin**). Zdeployowane 02:45 przez `sudo ./deploy.sh`,
  zweryfikowane na żywo: 12/12 kontenerów, 32/32 workerów, 168/168 testów,
  build backend+orchestrator+frontend `tsc` czyste. Wszystkie 9 było CICHYCH —
  kontenery healthy, endpointy 200, monitoring milczał.
  - **Alias `@postsider/*` w DYNAMICZNYM imporcie nie jest przepisywany przez
    `nest build`** (statyczne owszem — emitują `require("../../../../libraries/…")`).
    `post.activity.ts` + `webhooks.controller.ts` importowały tak
    `ssrf.safe.dispatcher` → `Cannot find module` w runtime, 18×/24h. Posty
    publikowały się, ale `sendWebhooks` padał ZAWSZE i zabierał ze sobą resztę
    workflow — **`internalPlugs`/`globalPlugs` nigdy się nie wykonywały**
    (6 workflowów Failed w Temporalu). Fix: specyfikatory relatywne + skip
    importu gdy brak webhooków. **Uwaga na przyszłość: nigdy alias w `import()`.**
  - **Publikacja na usunięty kanał.** `deleteChannel` robi tylko soft-delete
    (`deletedAt`) i ZOSTAWIA ważny token — nie ustawia `disabled`/`refreshNeeded`.
    Workflow nie sprawdzał `deletedAt`, więc ocalały post z QUEUE przechodził przez
    guardy i publikował na konto, które user odłączył. Dodany guard fail-closed
    (stan `Channel deleted`).
  - **Sweep kasowania postów przy usuwaniu kanału był fire-and-forget**
    (`.catch(()=>{})`, bez `await`) w OBU ścieżkach (dashboard + public API) —
    request kończył się zanim kasowanie dobiegło, błędy połykane. Dowód na żywej
    bazie: 8 postów QUEUE przeżyło usunięcie kanału. Teraz `Promise.allSettled`
    + await + log.
  - **`refreshToken()` w facebook/instagram to były puste stuby** zwracające
    `accessToken: ''` → `RefreshIntegrationService` czytał to jako revoke i
    ustawiał `refreshNeeded`, blokując ZDROWE kanały Meta ~60 dni po connect.
    Oba re-mintują teraz przez `fb_exchange_token`. **Instagram: token w bazie to
    kompozyt `pageToken___userToken`** — podmieniana jest tylko połówka user,
    page zostaje (gołe nadpisanie rozwaliłoby każdy `token.split('___')`).
    `refreshToken()` dostał opcjonalny 2. arg `integration`.
  - **PDF raportu padał na realnych danych.** `pdf-lib` ze standardowymi fontami
    to WinAnsi — `drawText` ORAZ `widthOfTextAtSize` rzucają na wszystkim spoza
    CP1252. Emoji w treści posta i polskie znaki w nazwie org/klienta = 500 na
    `/report/customers/:id/pdf`. Dodany `toWinAnsi()` (transliteracja ż→z, ł→l;
    reszta wycinana) na każdej ścieżce rysowania + test regresyjny (stary spec
    był ASCII-only, dlatego to przeszło). **Cyrylica/CJK są wycinane — pełny
    rendering wymaga `@pdf-lib/fontkit` + plik TTF, nie zrobione.**
  - **Raport zawyżał posty per kanał** — `perChannel` kluczowane po `name`
    zamiast `id`. Jedno konto pod tą samą nazwą na kilku platformach (u nas 5×
    "Local Waifu") → każdy wiersz pokazywał sumę wszystkich. Bratni
    `agency-overview.service.ts` kluczuje poprawnie po `id`.
  - **Cron analytics nigdy by nie dokończył przebiegu** — workflow deklaruje
    `heartbeatTimeout: '10 minute'`, aktywność NIGDY nie wołała heartbeat
    (jedyne użycie `heartbeatTimeout` w repo, zero wywołań). Duża org = timeout,
    3 retry w błoto, raporty z zerowym engagementem. Dodany
    `Context.current().heartbeat()`.
  - **`resend.provider` maskował każdą awarię maila.** SDK Resenda NIE rzuca —
    resolve'uje `{ data: null, error }`. Provider zwracał to jako sukces i
    dodatkowo połykał prawdziwe wyjątki w `{ sent: false }`, więc cała maszyneria
    retry/throw w `email.service.ts` (zbudowana po audycie 07.2026 właśnie po to)
    była omijana. Teraz rzuca, jak `node.mailer`.
  - **Reconnect w dashboardzie prowadził na 404.** `calendar.tsx` sprawdzał
    `res.url` PRZED `res.oauthUrl`, a `url` to zawsze state-token (nie link) →
    `window.location.href = "aB3dEfGhIj"`. `addChannelForPlatform` sprawdza
    poprawnie. Przy okazji reconnect nie pokazywał userowi ŻADNEGO błędu (tylko
    `console.error`) — dodane `channelError` + obsługa 402.

- **Agency/Overview rework + client reports (PDF + engagement) + agency-mode flag (2026-08-18).**
  All built + deployed via `sudo ./deploy.sh` (health-gated, full build — new
  dep `pdf-lib`), 167 root tests green, 12/12 containers, workers polling on
  `main` (0 backlog), migration `20260818000000_organization_agency_mode`
  applied. **Uncommitted as of session end** — sits on top of the 08-17 batch,
  all in the working tree on `main`.
  - **Phase A — "Agency" was the wrong product.** Research (Sendible/Planable/
    white-label guides) showed agencies want white-label, shareable,
    *results*-oriented reporting; the existing `/agency` page was really an
    internal ops "morning check" that asked for a pasted Public API key.
    Reworked it into an ops **Overview**: moved `/overview` +
    `/customers/:id/report` off the key-authed public API onto a session-authed
    `AgencyController` (`GET /agency/overview`, `/agency/customers/:id/report`),
    dropped the API-key input, renamed nav "Agency" → "Overview" (title
    "Delivery overview"), and enriched `AgencyOverviewService.getOverview` with
    real risk signals: `stuckPosts` (QUEUE past `publishDate`, no `error` — the
    silent-failure signature the host monitor watches) and `tokenIssues`
    (disabled/refreshNeeded/inBetweenSteps/expired token), both org-wide and
    per-client (client rollup shows "2 stuck · 1 error · 3 token issues" flags).
    Public `/public/v1/overview` kept for the MCP tools.
  - **Phase B — client reports (PDF + engagement).** `ReportService.buildReport`
    (org + customer + window) aggregates branding (logo+name), delivery
    (per-channel counts), engagement (sum of latest-per-post-per-metric from
    `PostAnalytics`), and top 10 posts (ranked by total engagement, recency
    fallback). `ReportPdfService` renders a branded PDF via **`pdf-lib`** (new
    dep, pure JS — no chromium, fits the 3072M limit): logo header,
    Performance/Delivery/Top-posts sections, pagination, HTML strip, graceful
    no-logo fallback. `ReportController` → `GET /report/customers/:id/pdf`
    (session, `Content-Disposition: attachment`); frontend "Download PDF" button
    on the customer card + `api.download` (blob) helper.
    **Engagement is real only after collection** — new daily cron
    `collectAnalyticsWorkflow` (`collect.analytics.activity.ts` →
    `collectForRecentPosts` iterates PUBLISHED posts (14d) and calls the
    existing `checkPostAnalytics`, which persists to `PostAnalytics`; added
    `findRecentPublishedForAnalytics` repo query). Registered as the 4th cron in
    `InfiniteWorkflowRegister` (armed: `missingPostWorkflow, mediaCleanupWorkflow,
    evergreenWorkflow, collectAnalyticsWorkflow`).
  - **Agency-mode flag.** `Organization.agencyMode` (Boolean, default false). The
    Overview tab is **hidden by default**; admin/superadmin enables it in
    Settings → Organization (checkbox; `agencyMode` added to `GET /user/self` +
    frontend `SelfUser`). Nav item gated via `agencyModeOnly`; `/agency` page
    shows a "disabled" notice with a link to Organization settings; backend
    `AgencyController`/`ReportController` **fail closed** with
    `ForbiddenException` (403) when off — used the standard 403, NOT the custom
    `HttpForbiddenException` (the exception filter remaps that to 401 + clears
    cookies).
  - **Open follow-ups (phase B v2):** engagement appears in a report only after
    the first `collectAnalyticsWorkflow` run (daily); the PDF embeds the org logo
    but NOT post thumbnails (top posts are text + channel + date + engagement +
    release URL); no auto-send to the client's inbox (the `Customer` model has no
    email field — natural next step, needs a cron + `EmailService`/Resend +
    `Customer.email`); the page is only meaningful for multi-client orgs (single
    "Unassigned" row otherwise).

- **Dashboard media preview + approval queue pass (2026-08-17).** Live owner
  bug reports, all built + deployed via `sudo ./deploy.sh` (health-gated,
  12/12 containers, 32/32 workers throughout), 162 root tests green.
  **Uncommitted as of session end** — the whole batch (22 modified + 3 new
  files) sits in the working tree on `main`, ready to commit.
  - **Post media never reached the calendar/posts list.** Backend `getPosts`
    (calendar) and `getPostsList` selects did not include `image`, and the
    minify key map (`posts.list.minify.ts` + frontend mirror) had no `image`
    entry — so no post's media was ever in the list/calendar payload. Fixed
    both; new `parsePostMedia()` (lib/posts.ts) turns the raw `image` JSON
    (id+path from API posts, or enriched path+url+type) into
    `{url, kind}[]`; `CalendarEvent.media` + `backendPostToEvent` now carry
    it; new `PostMediaThumb` renders a small thumb (image or video w/ play
    glyph) in MonthView, Week/Day timeline, DayPopup and Posts rows. The
    detail endpoint already returned media — it was purely the list/calendar
    path that dropped it.
  - **`updateMedia` hardcoded `type: 'image'`** for every attachment (so .mp4
    posts read back as "image"). Now `m.type || deriveMediaType(path)` —
    video/audio derived from extension when the Media row type isn't carried.
  - **Editing a post wiped its media.** `openEventForEdit` never prefilled
    `InitialPostValue.media` (the type had no media field), so saving a
    prefilled edit sent `image:[]`. Added `media` to `InitialPostValue`,
    prefill from `fetchPostDetail` (which now parses via `parsePostMedia`),
    and `AttachedMedia.backendId` so `submitPost`/`submitEdit` skip re-upload
    for already-persisted media. Also the composer's `requestClose`
    "Discard your changes?" confirm used a "is there ANY content" dirty check,
    true from mount in edit mode → warned on every untouched close. Now
    snapshots the prefilled state (`initialSnapshot` useMemo) and only flags
    real diffs (body/threads/media/date/time/channels/settings/firstComment).
  - **Same-time posts overlapped in day/week views.** `.timelineEvent` /
    DayPopup `.event` are `position: absolute` with `top` from time only, so
    two posts at 09:00 stacked exactly. New `lib/event-lanes.ts`
    (`layoutOverlappingEvents`, greedy first-fit lanes like Google Calendar)
    gives each overlapping event a `left`/`width`; used in Timeline and
    DayPopup.
  - **Posts row 3-dots landed in the wrong grid row + dropdown clipped.**
    `.row` had a 5-column grid but 6 children, so `actionsCell` auto-placed
    to a phantom second row, and `.list { overflow: hidden }` clipped the
    absolute-positioned menu. Added the 6th column (40px), switched `.list`
    to `overflow: visible` (rounding first/last `.row` for the corners), and
    placed `actionsCell` explicitly in the mobile media query. Menu items got
    `stopPropagation` so row-click (new) doesn't also fire.
  - **Clicking a post in the Posts list did nothing.** Rows had no `onClick`.
    Now opens the same `CreatePostModal` edit flow as the calendar
    (`openEventForEdit` + `submitEdit` + `refreshList` + `runDelete`
    migrated into posts.tsx), so Posts rows get full preview + edit + delete.
  - **Media library preview was tiny / video silent.** `.modalPreview` had
    only `min-height` (percentage `max-height: 100%` on the child resolved to
    auto), and the `<video>` had `autoPlay` without `muted` (blocked). Added
    `height: min(70vh, 640px)` + `img/video { width/height 100%;
    object-fit: contain }` and `muted playsInline`. Portrait videos were also
    force-cropped to 16:9 in the composer preview (`family === "video" ?
    "16 / 9"`); now `aspect-ratio: auto` + `contain` so portrait/landscape
    keep their real ratio.
  - **`POST /public/v1/upload` dropped file metadata.** It called `saveFile`
    without `originalName`, `fileSize`, `width`, `height` (the dashboard's
    `/media/upload-simple` passed them; the public-API endpoint didn't), so
    every API upload stored 0 B / no dims / no original name — invisible in
    the Media library. Fixed (now probes + passes size); `upload-from-url`
    likewise gets `buffer.length` + probe + name from the URL. `probeDimensions`
    extracted to shared `libraries/.../upload/probe-dimensions.ts` (sharp for
    images, ffprobe temp-file for video, `execFile` only) and media.controller
    refactored onto it. Verified live: fresh `/public/v1/upload` returns
    `fileSize`/`width`/`height`/`originalName`; old rows stay 0 (no way to
    recover without re-upload).
  - **Approval queue: thumbnails 80px, no video, sparse channel info.**
    `getPending` backend select now includes `integration.picture`; the card
    shows channel avatar (picture or monogram), a **22px platform badge**
    (enlarged from an 11px inline icon), readable platform name via
    `platformFromIdentifier` (was raw `providerIdentifier`), media count +
    image/video split, and a **large first-media preview** (image or
    playable video, full width) with remaining media as a 72px strip.
    Uses `parsePostMedia` (not the old url-only parser) so videos are
    distinguishable.
  - Test-only cleanup: no migrations, no schema changes this session.

- **Production smoke test (2026-08-14).** Public production checks passed:
  `GET /api/health` returned HTTP 200 with Redis, PostgreSQL, and Temporal all
  `ok`; `/`, `/login`, and `/register` returned HTTP 200; HSTS,
  `X-Content-Type-Options: nosniff`, and `Referrer-Policy` headers were
  present. Authenticated dashboard checks and VPS-side worker/container checks
  were not run in this pass because SSH key access was unavailable and no
  credentials/session for the dedicated `hunter19973` test account were
  provided. No production data, configuration, billing, OAuth connection, or
  publication was changed.
- **Release snapshot (2026-08-12).** Release commits `76360a5`, `8694212`,
  `387353b`, and `1224074` are committed on `main` and pushed to
  `origin/main` (`github.com/lumizone/postsider_production`). Production was
  deployed with `sudo ./deploy.sh --no-build` after the image build and is
  healthy: 12/12 containers running, `postsider-app` healthy with 0 restarts,
  API/frontend HTTPS endpoints 200, Redis/Postgres/Temporal healthy, 32/32
  Temporal workers healthy, `main` task queue backlog 0, Elasticsearch green,
  MinIO anonymous listing denied (403), and monitor/backup/certbot timers
  active. The deploy-created DB backup is under
  `/home/ubuntu/postsider_backups/predeploy-20260812-213249/`.
  `minio-init` policy rendering was fixed during deploy and committed as
  `1224074`.
- **Release follow-up owned by the operator:** public registration is live;
  the Polar checkout/webhook flow and real-channel publishing were verified
  after the release. Offsite backup and a full DB+MinIO restore still require
  manual verification. The current VPS backup helper backs up PostgreSQL, not
  the MinIO media volume.
- **TikTok `video.list` re-enabled (2026-08-20).** TikTok for Developers
  approved the scope, so the 2026-08-14 workaround is reverted:
  `tiktok.provider.ts` requests all 6 scopes again (`user.info.basic`,
  `video.publish`, `video.upload`, `user.info.profile`, `user.info.stats`,
  `video.list`) and the three `!this.scopes.includes('video.list')` guards are
  gone (`analytics()` video aggregation, `missing()`, `postAnalytics()`).
  Build clean, 168/168 tests green. **Existing TikTok integrations need a
  reconnect** — their stored tokens were granted before approval, so any
  `/v2/video/list/` call on them returns `scope_not_authorized`; it is caught by
  the surrounding try/catch (empty analytics + a console error, no publish
  impact), but video-level analytics stay empty until the user re-authorizes.
  `refreshToken()` does not call `checkScopes`, so old integrations keep
  publishing; only connect/reconnect enforces the full scope list.
  - **History — temporarily disabled (2026-08-14).** TikTok rejected OAuth
    because the production app did not have `video.list` approved yet.

- **Discord own-bot connect broken by the audit fix, fixed same day (`863604c`, 2026-08-09).** Live owner report right after the audit deploy: "can't add my own bot to Discord". The audit's `checkPreviousConnections` fix was a genuine regression — OSS returned true only for CROSS-org matches, so same-org re-adds sailed through to the upsert; scoping the query to the caller's org inverted that and same-org reconnects (shared-bot → own-bot switch on the same server) 409'd. **Fix: delete `checkPreviousConnections` + service wrapper entirely** — the upsert already dedups on `organizationId_internalId`, and removal closes the leak (no probe exists to leak). Also: own-bot errors were invisible — `authenticateWithOwnBot` threw a plain Error collapsed to generic "Authentication failed", and `this.fetch()` swallows Discord's body into `ApplicationFailure.details` ('Unknown Error'). Now raw `fetch` (host fixed, guildId digits-only — no SSRF) with status-mapped `NotEnoughScopes`: 401 → "Invalid bot token — reset in Developer Portal", 404 → "bot is not a member of that server". Owner re-tested: works. 138 tests green, deployed + verified healthy.
  - **Lesson:** an org-scoped query that flips `true`/`false` semantics is NOT a drop-in for a cross-org one — trace the caller's branch before "fixing" a leak. The audit report's recommendation to "scope to current org" was applied too literally; deleting the check entirely was both the leak fix AND the behavior fix.

- **Full SaaS-readiness audit (5 agents + direct VPS checks) + ALL findings fixed, deployed, pushed (2026-08-09, session 5).** 1 commit `c5050e7` on `feat/port-oss-features`, pushed to origin. Audit report: `docs/SAAS_AUDIT_2026-08-09.md`. 138 root tests green, all 3 workspaces build clean, deployed via `sudo ./deploy.sh` (12/12 containers healthy, 32/32 workers, 0 backlog, 0 stuck QUEUE posts, migration `20260809000000_add_post_share_token` applied, 0 errors in logs).
  - **CRITICAL — cross-tenant post leak closed.** `GET /public/posts/:id` was unauthenticated and returned ANY org's post by id — including the internal `error` field (a cross-tenant data leak; the 07-22 audit had only stripped `error`, never closed the route). Replaced with `GET /public/posts/shared/:shareToken` — a preview gated by a crypto-random `makeId(30)` token on the post row (`Post.shareToken`, migration `20260809000000`, set on create, never on update; frontend had no caller of the old route, confirmed before removal). `getPublicPost` strips `error` + `childrenPost` from the returned payload. Unknown token → `HttpForbiddenException` → 401 (the shared `HttpExceptionFilter` remaps `HttpForbiddenException` to 401 + clears cookies — pre-existing filter quirk, unchanged).
  - **HIGH — repository methods cross-org-safe.** `getPostById` now REQUIRES `orgId`; `updatePost`/`changeState`/`getPostByForWebhookId` take optional `orgId` (conditional filter in `where`). All service-layer + activity callers pass it through. Temporal workflow callers (6 files) untouched — the param is optional, existing calls compile.
  - **HIGH — `checkPreviousConnections` cross-org probing removed.** It queried integrations across ALL orgs by `rootInternalId` during the OAuth connect flow, letting an attacker probe whether an account was connected to ANY PostSider org. **Fully REMOVED** (not just scoped) — see the 2026-08-09 follow-up entry below: scoping it flipped the semantics and broke same-org reconnects (live regression caught by the owner on Discord own-bot). The leak is closed by removal, and same-org duplicates are handled by `createOrUpdateIntegration`'s upsert (keyed on `organizationId_internalId`) — no check needed.
  - **MEDIUM — webhook controller had zero `@CheckPolicies`.** `@CheckPolicies(ADMIN)` now on all 5 routes (list/create/update/delete/send). `POST /webhooks/send` was fully unauthenticated — with an SSRF-guarded dispatcher (not the leak) but still an open authenticated-any-org outbound POST; now ADMIN-gated.
  - **MEDIUM — `POLAR_ACCESS_TOKEN` startup validation.** `main.ts assertRequiredSecrets` now refuses to start on the managed cloud (`NEXT_PUBLIC_SELF_HOSTED !== 'true'`) if `POLAR_ACCESS_TOKEN` is unset/empty — without it `isBillingEnabled()` is false and every org is unlimited, silently. Self-host unaffected (they opt out of cloud mode).
  - **LOW — `docker-compose.production.yaml`** `POSTGRES_PASSWORD` fallback `:-postsider-secure-pwd-change-me` → `:?error` (hard fail if unset). `POSTGRES_USER` confirmed set in `.env.production`, so the new guard can't accidentally fire on dbgate's `PASSWORD_con1` either. **LOW — umami** got `mem_limit` 256M (app) + 128M (db) in `~/umami/docker-compose.yml` (host-side, outside this repo — needs `docker compose up -d` in `~/umami` to take effect, not covered by deploy.sh).

- **Live-bug-report session: Instagram connect, org branding, onboarding rewrite, team-invite privilege escalation, generic reconnect bug, Discord identity redesign (2026-08-07→08, session 4).** 8 commits `517af8e`…`091cffc` on `feat/port-oss-features`, each independently built + tested (138 root tests green throughout) + deployed live via `sudo ./deploy.sh`. Started from real owner bug reports, not a planned audit — several findings only surfaced because a human was actually using the product.
  - **Instagram connect wired the wrong page (`517af8e`).** Live report: picking "Local Waifu" during connect produced a channel named after the owner's own Facebook profile, and publishing failed outright. Root cause: the generic connect-picker only round-trips ONE field (`page.page`) back to `fetchPageInformation`, but Instagram's `pages()` returned `{pageId, id}` — two separate ids, no `page` field — so `data.pageId`/`data.id` were both silently `undefined` on every Instagram connect, ever. `pages()` now packs both into a composite `page: "pageId:igId"` string (no frontend change needed, the picker already prefers `page.page`); `fetchPageInformation` unpacks it, `reConnect()`'s direct-call shape still honored. Also hardened `integration.service.ts saveProviderPage` to reject (502) a page-selection result with no resolvable id, instead of silently persisting one (defense in depth for any provider, not just this one) — and explicitly requests `id` in the IG fields query + falls back to the id already queried by, since Graph API doesn't reliably echo `id` back on a node fetched by its own id. Two broken rows in the live org (`internalId` literally `"undefined"`) soft-deleted directly in prod.
  - **Organization logo never reached the sidebar (`f922223`, `6129dd3`).** Settings → Organization's logo upload saved fine but had zero visible effect — the sidebar brand mark was hardcoded to `/brand/postsider-logo.png` in all 3 spots, and the separate OrgSwitcher (the org picker/dropdown) rendered initials-only, never an `<img>` at all. Fixed both: `GET /user/self` now returns `orgLogo`, all 3 brand `<img>` tags fall back to it; `GET /user/organizations` already returned each org's `logo` (unfiltered Prisma `include`) but the frontend explicitly dropped it when mapping to `OrgSummary` — added, plus a shared `OrgAvatar` (logo when set, initials otherwise) used by the switcher's trigger and its dropdown rows. Org settings page calls `refresh()` after a successful save so both update immediately, not just on next login.
  - **Onboarding rebuilt: 2 steps → 4, real org name at registration (`4128ce3`).** Register form never actually collected an org name — silently sent the user's own name or a hardcoded `"My Organization"` fallback; now a real required field (backend `CreateOrgUserDto.company` already required ≥3 chars, frontend just never asked). Onboarding gained an attribution question ("how did you hear about us" — existed before 2026-08-06 too, but the answer was collected and discarded; now saved to new `Organization.referralSource`, migration `20260807190000_organization_referral_source`) and a static "two ways to publish" screen (dashboard vs Public API/MCP, linking to `/settings/api`) between welcome and connect. Welcome shows a "N-day trial active" badge, gated on the real `user.onTrial` flag — a second org from an existing user, or any org whose email already burned its `TrialUsage` row, never shows it, matching the actual one-trial-per-email rule (verified live: `deleteOrganizationCascade`/`deleteUserIfOrphan` never touch `TrialUsage`, so delete+re-register genuinely doesn't farm a new trial).
  - **SectionIntro removed entirely (`7cebfb2`).** Per owner: the "what is this section" explainer cards (calendar/posts/media/analytics/approval/billing/settings, added 2026-08-06) read as condescending rather than helpful ("I obviously know this is the billing page"). Deleted the component + all 7 call sites + i18n keys, not just fixed. `SetupChecklist` (the connect/post/schedule steps card) is unrelated and stayed.
  - **Team invite could grant ADMIN with no owner check (`47c3a76`).** `POST /settings/team` only required `@CheckPolicies` ADMIN-or-above to call it at all — nothing stopped a plain ADMIN from inviting (or re-linking an existing user as) a peer ADMIN via a raw API call. The frontend hides the "Admin" role option for non-owners, but that's UI only; `changeTeamMemberRole` (promoting/demoting an *existing* member) already enforced SUPERADMIN-only for this exact reason — the invite path just never got the matching check. Now mirrors it.
  - **Generic reconnect bug: display name frozen forever (`59d798e`).** Found chasing the Discord name issue below, but affects every provider: `createOrUpdateIntegration`'s Prisma upsert sets `name` in `create` but never in `update` — `picture`/`profile`/`token` all refresh on reconnect, `name` never did. Confirmed live: a Discord integration from June had its `picture` correctly update to the real server icon on reconnect while `name` stayed frozen at "PostSider" (the pre-fix value) forever, because the corrected value the provider computed was silently dropped by this one missing field in the update clause.
  - **Discord identity: webhook attempt, then reverted for bring-your-own-bot (`0e2809a`, `95bf82e`, `091cffc`).** Live report: connected Discord channels posted as "PostSider" (the shared bot's own name/avatar), not the actual server's. Root cause confirmed: `authenticate()` used the bot APPLICATION's own name/avatar for the connection's display data instead of fetching the actual guild's (`GET /guilds/{id}`) — fixed, and (via the generic reconnect-name bug above) needed the `update:` fix to actually take effect on existing rows. First attempt made posting itself show the server's branding via a per-channel Discord webhook (Bot API has no per-message identity override, only webhooks do) — required adding `MANAGE_WEBHOOKS` to the OAuth scope, which does NOT retroactively apply to already-invited bots (a live-verified Discord platform quirk, not a bug in this codebase) and added real complexity (webhook lookup/creation, permission-dependent fallback) for a problem with a simpler owner-preferred fix. **Reverted per owner direction**: shared-bot posts keep showing the shared bot's identity, unchanged from original behavior — PostSider's own dashboard still correctly shows the real server name/icon regardless (that part of the fix stayed). Added an actual alternative instead: at connect time, a choice (`DiscordBotChoiceModal`) between the shared bot and bringing your own (paste bot token + server ID, reusing the existing customFields convention every other manual-credential provider already uses — zero new endpoints). `resolveBotToken()` picks the right token per-integration (prefixed `custom:` marker) across `channels()`/`post()`/`comment()`/`changeNickname()`/`mention()`, all of which already received a token param but had every one hardcoding the shared bot unconditionally.
  - **Follow-up (`bce7bed`): the choice modal never actually appeared.** Live report right after deploy — connecting Discord went straight to the shared-bot OAuth redirect, no popup. `getIntegrationUrl` (`GET /integrations/social/:integration`) only computes `customFields` when `!isOAuthCapable` ("OAuth providers never expose manual credential fields", true and deliberate for every other provider) — Discord has an env mapping (`DISCORD_CLIENT_ID`/`SECRET`), so `isOAuthCapable` is true and that whole branch was skipped unconditionally; the `customFields()` method added in `091cffc` was reachable code that never actually ran, so `DiscordBotChoiceModal`'s `hasOAuth && hasCustomFields` check never passed. Special-cased `integration === 'discord'` alongside the existing check. Verified live post-deploy: env vars present, permissions bitfield back to the original `377957124096` (no `MANAGE_WEBHOOKS`, confirming the revert took), `customFields`/`resolveBotToken`/`authenticateWithOwnBot` all present in the compiled bundle.
  - **Not tested against a real Discord server by this session** (no live Discord access from here) — code reviewed, built clean, and the customFields-delivery path is now config-verified end to end, but the owner should still click through both the shared-bot path (should be unchanged from original pre-session behavior) and a fresh own-bot connect at least once.

- **Billing/Polar audit (4 fixes) + infra audit + support contact, all deployed (2026-08-07, session 3).** 5 commits `0ba32c7`…`6c747c1` on `feat/port-oss-features`, each independently built + tested (138 root tests green throughout) + deployed live via `sudo ./deploy.sh` (5 separate health-gated deploys), pushed to origin.
  - **Billing access-control audit — `billing.controller.ts` had never been reviewed since Stripe removal (`git log` showed only the removal commit + the initial port).** It was the only sensitive controller in the repo with zero `@CheckPolicies`/role gate: any authenticated org member (role USER) could hit `POST /billing/subscribe`, `/embedded`, `/cancel`, and `GET /billing/portal` directly, bypassing the frontend's owner-only gate — worst case, cancel the org's paid subscription. Fixed with `assertOwner(org)`, a manual `org.users[0].role === 'SUPERADMIN'` check (`0ba32c7`, tightened from an initial `Sections.ADMIN` `@CheckPolicies` pass to owner-only per product decision — `df1c787`), same pattern `deleteAccount` already used. Mirrored on the frontend: `billing/page.tsx`'s `canManage` was `ADMIN || SUPERADMIN`, disagreeing with the sidebar nav's own `minRole: "SUPERADMIN"` on the Billing link (an ADMIN could reach the page by URL but would never see it in nav) — now SUPERADMIN-only on both, matching nav.
  - **Double-subscription risk on plan upgrade/downgrade (`0ba32c7`).** `PolarService.subscribe()` always created a brand-new Polar checkout, even for an org with an already-active paid subscription — Polar checkout does not cancel/replace an existing subscription for the same customer, so clicking "Upgrade" risked a second concurrent recurring charge, invisible locally since `Subscription` is one upsert-overwritten row per org. Now swaps the product on the existing subscription via `polar.subscriptions.update()` (reusing `onSubscriptionUpserted` so the DB updates synchronously, not just via the async webhook), falling back to a fresh checkout only for trial/lifetime/no-subscription orgs or on API failure. `checkSubscription`/`checkCheckout` polling also fixed to match the checkout's own `resultingSubscriptionId` instead of "any subscription exists" (was reporting false "done" against the stale pre-upgrade tier mid-upgrade).
  - **Zombie billing on account deletion (`00966df`).** `deleteAccount` → `deleteOrganizationCascade` deleted the local `Subscription` row but never called Polar — a deleted org left its real Polar subscription active, billing the customer indefinitely with no org left to view or cancel it from. New `PolarService.cancelActiveSubscriptionBestEffort()`, called before the cascade delete; best-effort (never throws — must not block the irreversible local deletion), no-ops for trial/lifetime, logs loudly on failure. Same commit: `deleteSubscription` no longer deletes the DB row when `modifySubscription`'s lifetime guard had refused (was undermining its own protection one line later); plan-change notification added (`onSubscriptionUpserted` emails the org's admins via `notifyApprovers` when tier/period actually changed, snapshotted before the upsert so duplicate/retry webhooks don't spam).
  - **Config verified live, not just read from `.env.production`:** all 8 `POLAR_PRODUCT_*` + token/server/webhook-secret/org-id confirmed present via `docker exec printenv`; webhook endpoint correctly 403s an unsigned `POST /polar`. **Not verifiable from this session** (outbound call to Polar's API with the live prod token was blocked by the harness's own auto-mode classifier): whether the 8 product ids are `active` in the Polar dashboard, and whether the webhook URL is actually registered there — owner confirmed both done, but no real Polar webhook had hit the server yet as of this session (nginx access log showed only this session's own unsigned test curl, 403).
  - **Core pipeline (scheduling/publishing) + infra live-audit, all confirmed healthy, no code changes needed:** 0 stuck `QUEUE` posts, 0 publish errors in the last 14 days, Temporal `main`-queue pollers alive with 0 backlog, `RUN_CRON=true` (cron workflows armed), refresh-token workflows self-looping correctly (verified one has run for a month, 12k+ state transitions, refreshes 5 min before expiry) — the one dead exception is the owner's own GMB test integration (`inBetweenSteps=true` since 2026-07-02, structurally excluded from re-arming forever until manually reconnected; not a customer, already a known low-priority item). Infra: Temporal server `SERVING`, ES visibility store `green`, Postgres/Redis light and healthy, MinIO anon policy still `GetObject`-only (07-22 fix held), backup verified via today's actual `journalctl` run (not just the timer being active) covering `postsider_prod` + `temporal` + MinIO + config, `postsider-app` memory 62% of its 3072M limit, 0 container restarts. One config note, not a bug: Temporal's `default` namespace has only `WorkflowExecutionRetentionTtl: 24h` — closed workflow history disappears from Temporal after a day (the real failure signal lives in `Post.error` in Postgres regardless, which the backup covers) — flagged to the owner, not changed.
  - **SaaS-launch punch list re-verified live (corrects two stale claims from the 08-07-session-1 entry below):** `DISABLE_REGISTRATION` still `"true"` (real blocker — public `/register` has never been tested end-to-end on prod), offsite backup still missing (`rclone` not installed, confirmed), **no support/help contact fixed this session** (see next bullet), UptimeRobot still unverifiable from here (external). **LinkedIn reconnect — the prior sessions' repeated "still pending" was stale:** the live `linkedin` integration is healthy (token valid to 2026-09-30, not disabled/inBetweenSteps); the old revoked `linkedin-page` rows are already soft-deleted. No action needed; correcting the record so it stops being re-flagged.
  - **Support contact added (`6c747c1`).** `mailto:contact@postsider.com` in `AuthShell`'s footer (pre-login, next to Terms/Privacy) and the dashboard sidebar footer (post-login, next to Sign out) — closes the "zero support contact anywhere in the app" gap. en/pl i18n keys added; other locales fall back to English per existing convention. The mailbox itself needs to actually receive mail (Resend/DNS) — not verified, app-side only guarantees the link.

- **SaaS-readiness audit + 2 HIGH fixes + Organization Settings page + onboarding polish, all deployed (2026-08-07).** 2 commits `a1816d0`, `59c4512` on `feat/port-oss-features`, pushed, both deployed live via `sudo ./deploy.sh` (2 separate health-gated deploys, migration `20260807120000_organization_logo_timezone` applied cleanly on the second), 138 root tests green throughout, both fixes independently re-verified by a fresh review pass (no shared context with the audit or the fix) before the second deploy.
  - **Organization Settings (`/settings/organization`, ADMIN+, `a1816d0`).** New: logo upload (reuses the existing media pipeline, no new upload endpoint), org name/description edit, default timezone (`Organization.logo`/`defaultTimezone`, nullable). Default timezone feeds `queue-plan`'s `getQueuePlan` as a fallback when a channel has no timezone of its own — per-channel setting still wins, hard `'UTC'` only when neither is set. Member management (`/settings/users`) and danger-zone disconnect/delete (`/settings/security`) already existed — linked from the new page instead of duplicating destructive controls in two places.
  - **Onboarding polish (`a1816d0`).** Welcome step gets three short value-prop bullets instead of a bare CTA, still two steps total (didn't regress toward the pre-08-06 four-slide flow). `SetupChecklist` gets a visual progress bar next to the existing "X of Y" text. **PL locale onboarding block was silently stale** since the 08-06 rebuild — still had the old 4-slide/attribution-question keys, wrong `connectDesc` copy, missing `connectCta` (silently fell back to English) — rewritten to match the current 2-step flow. Other locales (ru/de/fr/...) likely have the same staleness; not audited this session.
  - **Audit: is this ready for a full SaaS launch (registration intentionally left untouched)?** Two parallel fresh-eyes review passes (no access to the 08-06/07 session's own reasoning) over security-regression and plan-limit-enforcement, plus direct ops checks (Sentry DSN, offsite backup, TLS, disk, legal pages, email provider). Found two real, live-exploitable HIGH bugs neither prior pass had caught — see below. Everything else from the 07-22/07-31/08-06/08-07 passes reconfirmed clean, not re-litigated. **Ops gaps for a real SaaS launch, unchanged from prior sessions, need the owner (none are code):** offsite backup still missing (single VPS = single point of failure for all customer data), GMB still borrows `YOUTUBE_CLIENT_ID/SECRET` (widens Google review scope), LinkedIn reconnect still pending, UptimeRobot dead-man's switch still unverified, no support/help contact found anywhere in the app. Confirmed fine: Sentry DSN is set (resolves an old open item), Terms/Privacy/data-deletion all live at 200, TLS certs valid (33-81 days out, auto-renew), disk 54% used, email runs through Resend (not raw SMTP, so the empty `SMTP_HOST` is expected, not a gap).
  - **HIGH — approval-flow bypass (`59c4512`).** `PostsService.changePostStatus`/`changeDate` had no check on the post's current state. `PUT /posts/:id/date` (dashboard, any org role, no `@CheckPolicies`) and `PUT /public/v1/posts/:id/status` (Public API + the MCP `postsider_update_post_status` tool) could force a post straight from `APPROVAL` to `QUEUE`, silently pulling it out of human review, or reschedule an already-`PUBLISHED` post. The 08-06/07 session's drag-drop fix (`isDraggableStatus()`) covered the calendar UI only — never touched these backend entry points, so the same bug class survived via a different door. Fixed: new `assertMutable()` blocks both methods on `PUBLISHED`/`APPROVAL`. The one legitimate internal caller that moves a post OFF `APPROVAL` (`ApprovalService.onApproved`, the real approve action, both admin and guest-link paths) already runs `assertCanApprove(role)`/`assertPending(approval)` before reaching in, so `changePostStatus` grew an explicit `allowApprovalTransition` param that only that call site sets — verified as the only caller across the repo that does.
  - **HIGH — evergreen billing bypass (`59c4512`).** `EvergreenController` had zero `@CheckPolicies` on any route (any `USER`-role member could enable it or set `maxPerRun` to an arbitrary number), and `EvergreenService.recycleOnce` — called daily from a Temporal activity, never through the HTTP guard — created and published real new posts with no check against the org's `POSTS_PER_MONTH` plan limit, so a FREE-tier org (cap 0) could recycle forever. Fixed: `toggle`/`saveSettings` now require ADMIN; new `EvergreenSettingsDto` clamps `maxPerRun` (1-20) and `intervalDays` (1-365) via class-validator, `saveSettings` clamps again server-side as defense in depth; new `hasPostsQuotaRemaining()` mirrors `PermissionsService.check`'s `POSTS_PER_MONTH` branch exactly (same "manual mirror" pattern already used for `NoAuthIntegrationsController`'s channel-capacity check, including the `createdAt` fallback — first written as `new Date()`, caught as a correctness nit by the verification pass and fixed to the org's own `createdAt` via `OrganizationRepository`) and `recycleOnce` returns `null` once the cap is hit, the same signal already used for "no candidate left".
- **Billing-bypass fixes + self-service API keys + multi-agent UX audit (2 rounds) + interactive onboarding + internal 4-agent audit, all deployed (2026-08-06 → 2026-08-07).** Very long session. 8 commits `c42c04a`…`70ba070` on `feat/port-oss-features`, all pushed, all deployed live via `sudo ./deploy.sh`, 138 root + 27 MCP tests green throughout, final deploy live-verified (12/12 containers, 32/32 orchestrator workers, 0 stuck `QUEUE` posts, new code confirmed physically present in the shipped `.next` bundle via grep, not just "build succeeded").
  - **Billing audit — two real, live-exploitable bypasses closed (`c42c04a`).** `PoliciesGuard` (global `APP_GUARD`) had bypass prefixes `/public` and `/integrations/provider/` that were meant for genuinely unauthenticated routes but also matched `PublicIntegrationsController` (`/public/v1/*`) and `IntegrationsController`'s `/provider/:id/connect` — both of which DO set `req.org` via their real middleware, so the bypass was unnecessary and meant **Public API keys could publish and connect channels with zero plan-limit enforcement** (unlimited channels, unlimited posts/month regardless of tier). Removed both prefixes from the guard bypass (kept only `/auth` and `/integrations/social-connect`, the latter because `NoAuthIntegrationsController` genuinely never runs through auth middleware — it got a manual channel-capacity check instead, mirroring `PermissionsService.check`'s existing CHANNEL logic verbatim). Live-verified: `GET /public/v1/social/x` with a disposable 0-channel STANDARD test org now returns `402` (previously `200` with a real OAuth URL).
  - **Self-service Public API keys were dead on arrival (`b302559`).** `Settings → API`'s "generate a key" flow (and the MCP README's documented setup path) writes to the `ApiKey` table, but `PublicAuthMiddleware`/`getOrgByApiKey()` only ever checked the legacy single `Organization.apiKey` column — every self-service key 401'd on every Public API/MCP call, forever. Found independently by two different persona agents on their first real integration attempt (see audit below). Fixed: `getOrgByApiKey` now falls back to the `ApiKey` table (matched via the same deterministic `AuthService.fixedEncryption` used at key creation) when the legacy lookup misses. Live-verified: a freshly generated key went from `401` to `200`.
  - **Multi-agent live-prod UX audit, round 1 — 4 personas (agency owner, developer, automation/RevOps engineer, GTM engineer), each with real disposable tester accounts + seeded fake channels.** Full report: `docs/PRELAUNCH_MULTI_AGENT_AUDIT_2026-08-06.md`. Biggest finding: the full-page onboarding flow (`/onboarding`) was **unreachable in production** — it only fires on the register/activate paths, both gated behind `DISABLE_REGISTRATION=true`, so all 7 real prod users (private-beta accounts created manually) had never seen it. Its one action step was also broken: `ConnectStep` linked to `/integrations/social/:platform`, which is the OAuth **callback** page, not the start — without `?code=&state=` it just showed an error. Also flagged: hardcoded platform list duplicating the real one (already drifted once, at the Threads hide), an "attribution" step whose answer was collected and discarded, and the same dead self-service-API-key bug independently.
  - **Interactive onboarding rebuild + setup checklist (`e647be4`).** Researched onboarding UX patterns before building (tours vs. contextual help): linear tours lose ~78% of users by step 3 and tour-abandoners churn 34% more than users given contextual guidance instead. Rebuilt `/onboarding` from 7 passive steps (4 feature slides + a discarded-answer question) down to 2: welcome, then connect — which now hands off to `/calendar?connect=1` instead of reimplementing per-provider connect branching, so there's one connect implementation and no local platform list to drift. New `SetupChecklist` component on the calendar covers every account that never passes through registration (i.e. all of prod today): 3 items (connect a channel / write a post / set posting times), completion **derived from real data** (channel count, post count, `postingTimes` differing from the Prisma schema default) rather than stored flags, so it can't disagree with the account's actual state — only the dismissal is persisted, in localStorage.
  - **Multi-agent audit round 2 — 5 new personas (solo creator, small-business owner, virtual assistant, ecommerce brand lead, mobile-only user), zero overlap with round 1.** Two of five orgs deliberately left empty (genuine cold-start, not seeded) after round 1 taught that seeding every persona a channel hid the real first-run experience from the agency-owner persona. Real, verified findings, all fixed same session: `duplicatePost` silently dropped `firstComment` (where IG hashtags live) while copying thread parts, and returned the new post's id under a `group` key so `GET /posts/group/<value>` 404'd on every duplicate; four social providers (`instagram`/`facebook`/`threads`/`linkedin.page`) hardcoded `percentageChange: 5` in their analytics, rendered as a confident "+5.0%" next to real figures with nothing behind it (no post analytics are persisted to compare against — field made optional on `AnalyticsData`, frontend already hid the badge when absent); the shipped `/csv-template.csv` referenced channels no org has and a hardcoded now-past date, so downloading-then-reuploading the flagship bulk-import feature failed 100% of rows on the very first try; `resolveApproval` returned the malformed key `{"rejectd":true}` on every rejection (typo in `action+'d'`, no live caller was reading it, still fixed); the calendar refused to drag anything not already `"scheduled"` even though the backend accepts drafts; auth-page inputs were 14px, so iOS Safari zoomed the viewport on the very first screen anyone opens on a phone.
  - **Contextual onboarding: `SectionIntro` + `InfoTip` (`3c242a6`).** The 2-step onboarding fixed *activation* but not *comprehension* — a first-run tester (Kai) could not define "channel", "queue", "slot", "evergreen", "first comment", "snippets", "draft", or "global vs. per-channel", none of which were explained anywhere in the app outside a billing-page FAQ nobody visits before connecting an account. Deliberately NOT a product tour, per the same research above (short flow + checklist + contextual help beats a tour on every measured axis, 2.5× engagement vs. static/tour approaches). `SectionIntro`: one-time dismissible per-section explainer card, wired into calendar/posts/media/analytics/approval/settings/billing. `InfoTip`: a "?" that defines one term in place, **opens on click not hover** (hover-only help is invisible on touch — the mobile persona's own finding, applied here pre-emptively), wired into the setup checklist, the composer (write-mode tabs, first-comment field, snippets panel), the queue-plan slot picker, and the evergreen enable toggle.
  - **Internal 4-agent audit of the whole session's diff, one blocker found (`70ba070`).** Rather than trust each commit's own incremental checks, ran 4 parallel agents to independently re-verify: backend correctness, frontend wiring/consistency, a from-scratch build across all 4 workspaces (with the orchestrator's workflow-sandbox reachability specifically traced — `posts.service.ts`'s changes only reach a workflow file through a type-only generic argument, never a value import, confirmed NOT to enter the Temporal bundle), and a security/tenant-isolation regression pass on the billing/auth changes (**clean**, no regressions — the one flagged issue, a TOCTOU race on the channel-capacity check, is a pre-existing pattern the new code faithfully mirrors, not something this session introduced). **Blocker:** the drag-drop-drafts fix from round 2 didn't work — `moveEvent` was relaxed, but `MonthView`/`Timeline`'s `canDrag` (the code that actually sets `draggable`) was a separate, untouched check still requiring `"scheduled"`, so a draft's `draggable` stayed `false` and `dragstart` never fired. Fixing it surfaced a second issue: the relaxed rule would also let a `pendingApproval` post be dragged, and `PUT /posts/:id/date` accepts any non-published post and sets `state:QUEUE` — so once the two checks agreed, dragging an approval-pending post would have silently pulled it out of review and scheduled it for real publish. Both now go through one `isDraggableStatus()` excluding `"published"` and `"pendingApproval"`. Also fixed: the checklist's own "write a post" button didn't refresh its post count (stuck un-done until reload); the CSV template generator didn't escape embedded `"` in channel names (invalid CSV on a name that had one); `?connect=1` opened the add-channel modal even for the member role, unlike the panel's own gated button; a frontend type left out of sync with the prior `duplicatePost` fix. Dead code removed: ~70 lines of CSS from the deleted onboarding platform-picker step, the now-unreferenced static `csv-template.csv`.
  - **Known open, not fixed this session (product decisions or out of scope):** multi-org creates a separate trial+subscription per org while pricing is flat per-org — UI now at least warns at org-creation time ("each organization has its own plan, billing and channel limits") but the underlying agency-of-15-clients pricing model question is still open; no conversion/revenue analytics metric anywhere (only reach/likes/saves — a real gap for proving ROI, flagged by the ecommerce persona); UTM presets are org-level with no per-channel binding and must be applied manually every post; no bulk select/bulk reschedule/bulk delete on the Posts list or calendar; switching organizations hard-reloads and loses the current view; team invites still show a password on-screen for manual handoff rather than emailing one (a **deliberate prior-session security decision** — passwords-by-email is its own risk — not reopened here); Smart Slots suggests times from the org's own posting-rhythm histogram, not audience engagement (no post-analytics persistence to drive it from, documented pre-existing limitation).
- **Threads hidden, SaaS-mode fix, media metadata, agency-grade approval, security-clean (2026-08-05, session 2).** Long session, all built + deployed + pushed (7 commits `795ddff`…`381833a` on `feat/port-oss-features`; `795ddff`+`298a639` also merged to `main` via `fa46ecc`). 132 root + 27 MCP tests green throughout, full security-review pass on the whole diff found **zero HIGH/MEDIUM findings** (execFile-not-shell for the new ffprobe call, org-scoping verified on every new endpoint incl. cross-tenant checks on `resolveApiRequester`).
  - **Threads hidden from UI** (`795ddff`) — no positive Meta app review yet. Removed from `add-channel-modal.tsx` connect picker + `onboarding-flow.tsx`. Backend/provider/OAuth/Meta-compliance-callback untouched — flip back on once reviewed.
  - **🔴 SaaS-mode misconfig found + fixed** (`298a639`). `NEXT_PUBLIC_SELF_HOSTED="true"` was set on the managed cloud instance (leftover from image defaults) — made `GET /settings/storage` skip its SaaS 403 gate, so **any customer org admin could see the shared MinIO bucket/region/URL config**. Fixed: env flag → explicit `"false"` (must be explicit, not unset — `docker-compose.production.yaml` build arg defaults to `:-true` when absent) + a real frontend bug fix (`settings-shell.tsx` compared `!process.env.X`, true for ANY set string including the literal `"false"`; now matches the backend's `=== 'true'`). `DISABLE_REGISTRATION` was toggled open then closed back to `"true"` same session (private beta stays private; the SaaS-mode fix is independent and stays live).
  - **Media library metadata was silently broken.** `getMedia()`'s Prisma `select` never included `fileSize`/`type`/`createdAt` — every item showed 0 B, defaulted to "image" kind, no upload date (`7a11626`). `saveFile()` never persisted `fileSize` either (Multer's `file.size` was available and simply never passed through). Also added `width`/`height` (new nullable `Media` columns, migration `20260805170000_media_width_height`): images via `sharp` on the in-memory buffer (`4c8c68c`), video via `ffprobe-static` — new dep, static linux/x64 binary, buffer spilled to a temp file since ffprobe needs a real path, `execFile` (not shell) so no injection surface (`9d291ad`). Presigned/R2-multipart upload paths still default `fileSize`/`width`/`height` to 0/null (no local buffer available there) — unchanged, not a regression.
  - **Approval flow made agency-usable, deliberately kept 100% optional** (no role now forces anyone through it — a product decision, not an oversight). Audit first (`docs` conversation, not committed as a file — findings baked into the fixes below): traced every entry point (dashboard composer, Public API, MCP/Claude Code, CSV import, duplicate, evergreen, webhooks) and found approval had no Public API surface at all, no MCP tool, and CSV import hardcoded straight to QUEUE with no draft option.
    - `POST /public/v1/posts/:id/request-approval` (`cf98905`) — lets an external content pipeline (agency's own generator, n8n, …) push an already-created draft into the human approval queue with zero manual step. Public API has no session user, so `ApprovalService.requestApprovalFromApi` attributes the request to the org's own SUPERADMIN (`resolveApiRequester`, scoped via `getAllUsersOrgs(orgId)` — verified cross-tenant-safe).
    - `GET /public/v1/posts/:id/approval` (`381833a`) — read-side counterpart; `GET /posts` only exposes `state` (can't tell "rejected" from "never submitted", never carries the reviewer's note) so this returns `{status, note, requestedAt, resolvedAt}` or `{status:'NONE'}`.
    - MCP: `postsider_request_approval` + `postsider_get_approval_status` tools (`381833a`) wrapping the two endpoints above, so Claude Code / AI agents don't need to hand-roll raw HTTP.
    - CSV import: opt-in `asDraft` flag, backend param + frontend checkbox (`381833a`) — `type` was hardcoded `'schedule'` (straight to QUEUE, zero review option ever). Off by default, existing callers unaffected.
  - Historical follow-ups from this session were subsequently resolved or superseded. The current operator follow-ups are listed in the release snapshot at the top of this file.
  - **Push, TikTok production, Polar confirmed (2026-08-05).** All 37 uncommitted production hotfixes from the 08-01/08-02 sessions committed as `ef5f793` and pushed to `origin/feat/port-oss-features`. **TikTok switched sandbox→production** — existing sandbox TikTok OAuth tokens require reconnect. Polar production confirmed live (2026-08-02). Later release commits are now on `main`; current manual follow-ups are listed in the release snapshot.
- **Approval flow agency-grade + multi-org UI + SaaS gating + Polar live (2026-08-02).** Four feature batches, all built + deployed:
  - **Approval flow upgraded.** PostApproval now drives a real workflow: `requestApproval` sets post state to `State.APPROVAL` (the previously-dead enum value — now distinguishes "draft pending review" from plain drafts); `reject` restores `DRAFT`. Emails on resolution: approvers get notified on request (`notifyApprovers`, ADMIN/SUPERADMIN only), the original requester gets email on approve + reject-with-note. Approval page shows media thumbnails, full content (expand/collapse), publishDate, platform — `getPending` now selects `image`/`settings`/`state`/`publishDate`. Calendar maps `APPROVAL` → `pendingApproval` status badge; Posts page has a "Pending approval" filter. Composer gained "Send for approval" button (new posts + re-submit after reject) with a rejection banner. `assertRequestable` now accepts DRAFT or APPROVAL.
  - **Multi-org UI.** Backend was already multi-org (UserOrganization join, `showorg` cookie, `GET /user/organizations`, `POST /user/change-org` all existed but were dead). Added the frontend: `auth-context` loads org list + `switchOrg()` (POST change-org → hard reload so every data hook re-scopes); `dashboard-shell` got an OrgSwitcher dropdown in the sidebar footer (initials, role, checkmark on current; shown only when 2+ orgs). One email, many client orgs, per-org roles.
  - **SaaS feature gating.** Sidebar nav now has `minRole`: Settings → ADMIN, Billing → SUPERADMIN (pattern from `settings-shell.tsx`). Members (USER) no longer see Settings or Billing in the sidebar. Removed the Post Checker settings tab entirely (`/settings/post-checker` + nav entry) — it's provider-side infra (BYO-key only), not a tenant feature; the composer's Check Post / Rewrite buttons remain for users.
  - **Polar live.** `POLAR_SERVER` switched `sandbox`→`production` with real token (`polar_oat_9ASp…`), webhook secret (`whsec_m6q…`), and all 8 production product IDs (STANDARD/TEAM/PRO/ULTIMATE × monthly/yearly). Backup of sandbox env: `.env.production.bak-polar-sandbox-20260802-013442`. Existing sandbox subscriptions stay in DB; new ones bill real money via Polar MoR.
  Deployed 2026-08-02 (multiple deploys), 32/32 workers healthy. Later release work superseded the old branch merge follow-up.
  - **CodeRabbit review + analytics fix + deploy (2026-08-01).** Pulled 2 commits (`408fbcd` + `82af8a9`) from `origin/feat/port-oss-features` — CodeRabbit security/correctness pass across 94 files: auth (NOT_SECURED `=== 'true'`, Farcaster/Wallet return `false`, GitHub primary-email verify, CSRF origin normalize, permissions fail-closed, invite guard), social providers (all ~30), upload (ESM `detect-file-type.ts` replacing `require('file-type')`, crypto random filenames, remote media timeout/500MB cap, **R2 multipart fix** — client hung on successful upload), Redis (MockRedis TTL/expiry), webhooks (org-ownership validation), throttler (IP-based instead of `undefined_other`), OpenAI (lazy init, no `sk-proj-` fallback), subscription (null-safe pricing). Fixed `whop.provider.ts` syntax error (duplicate `},` from CodeRabbit commit). **Threads analytics hardened:** `analytics()` raw `fetch` → `this.fetch` (retry + error handling), added `clicks` + `followers_count` metrics, removed undocumented `period=day` param, **post-level fallback** — when user-level `threads_insights` returns all zeros (Meta blocks for accounts <100 followers), aggregates per-post `/{threadId}/insights` from recent threads so the analytics panel shows real data instead of empty charts. Bumped `temporal-es` 640M→768M (`ES_JAVA_OPTS -Xmx384m`, was 256M, 91%→81% usage). n8n capped: `mem_limit` 11g→4g, `cpus` 5.8→2, `N8N_PAYLOAD_SIZE_MAX=128` (was invalid `128mb`). **Deployed to production** (build clean backend/orchestrator/frontend, 132 tests green, 32/32 workers healthy post-deploy, zero app errors). Full audit: 12/12 containers healthy, 20/20 pages 200, all 7 HTTPS endpoints 200, 0 stuck QUEUE posts, 0 orphaned DB rows, daily backup OK, monitoring silent. Later release commits superseded the historical open follow-ups; see the current release snapshot at the top.
- **Release-ready & pushed (2026-06-28).** Single env-gated repo; all inherited Postiz AI stripped (see "No other AI"). Branch `feat/port-oss-features` pushed to `github.com/lumizone/postsider`. This session: removed Stripe (Polar-only), dropped orphaned stripped-AI Prisma models (migration `20260628160000`), added the lean MCP server (`apps/mcp`), `SECURITY.md`/`CODE_OF_CONDUCT.md`/CI, and dep CVE overrides (audit: **0 high**). Verified: backend/orchestrator/frontend/MCP builds + **127 root + 27 MCP tests** green; all migrations apply on a fresh real Postgres; backend boot (health + auth 401) + frontend `/login` e2e ok. **Deployed to a production VPS 2026-06-28** (branch `feat/port-oss-features`); both migrations applied cleanly on the existing prod DB with data preserved, and **live publish verified end-to-end** (created via public API -> orchestrator -> Temporal `threads` worker -> published on Threads, `PUBLISHED` + releaseURL). Remaining (user): merge `feat/port-oss-features` -> `main`; reconnect any user-revoked social integrations (a personal LinkedIn token came back `REVOKED_ACCESS_TOKEN` and needs a fresh OAuth connect).
- **Provider + connect-flow pass (2026-06-30).** Removed 8 unused providers ENTIRELY (`gmail`, `reddit`, `kick`, `rumble`, `vk`, `bear-blog`, `mewe`, `skool`) — provider + DTO files, `AllProvidersSettings` union/array, manager registration, connector catalog, add-channel/onboarding lists, icons, and every keyed map (integrations labels, preview-families, provider-requirements, platform-icon, env-maps). Added two dedicated connect flows (the OAuth/customFields path can't express them): **Telegram** — one shared platform bot (`TELEGRAM_TOKEN`/`TELEGRAM_BOT_NAME`), `TelegramConnectModal` + `/connect <code>` polling of `GET /integrations/telegram/updates`; and **Farcaster** — Sign In With Neynar (`NEYNAR_CLIENT_ID`/`NEYNAR_SECRET_KEY`), `FarcasterConnectModal` loads the SIWN CDN widget, `get-oauth-url` returns `neynarClientId`. Fixed the Whop dependent forum dropdown (`field.remoteParam` threads the parent value into the remote-select fetch). Trimmed YouTube OAuth scopes to match the Google console (5: userinfo.profile/email + youtube.force-ssl/readonly/upload). Upgraded Smart Slots. All deployed; pushed to `feat/port-oss-features`.
- **Code-review pass (2026-06-30, high effort).** A workflow code review surfaced 10 verified defects; **8 fixed + deployed**: orphaned-provider crashes from the removal (`getIntegrationList` skips rows whose provider is gone — was a dashboard-wide 500; publish activity throws a clean per-post error instead of crashing the worker on undefined), Smart Slots no longer falls back to colliding slots, `.env.production.example` `NOT_SECURED` commented out, find-slot with no posting times → default-hours fallback (was a 400), refresh-token null-`tokenExpiration` daily re-check (was a 60s hot-loop hammering the token endpoint), evergreen recycles into the post's OWN channel, UTM keeps a balanced trailing `)`, Threads re-adds the `threads_manage_replies` scope. Two left OPEN by design (see Notes "Known open issues").
- **Trial + composer/settings + private-beta pass (2026-07-02).** All deployed; pushed to `feat/port-oss-features` (commits `9702706`…`ab77196`).
  - **Real 7-day STANDARD trial.** New signups (first ever per email, billing on) now get an actual STANDARD Subscription — `organization.repository.createOrgAndUser` nested-creates one (`subscriptionTier=STANDARD`, `totalChannels=pricing.STANDARD.channel ?? 5`, `period=MONTHLY`, `identifier='trial'`, `cancelAt=now+7d`), gated on `allowTrial && isBillingEnabled()` (self-host stays unlimited; the one-trial-per-email `TrialUsage` guard still applies). `subscription.service.getSubscriptionByOrganizationId` now returns `null` once a `identifier==='trial'` sub's `cancelAt` has passed, so the org cleanly drops to FREE (scoped to trials, so Polar subs stay in Polar's webhook lifecycle). Fixes new users hitting "channel limit" immediately (FREE=0 channels) because the old code set the `isTrailing` flag but never created a subscription. Verified end-to-end; one pre-fix stuck org was backfilled by hand.
  - **Blogger publish fix.** `blogger` was registered/connectable but missing from `AllProvidersSettings` (union + `allProviders()` array), so `EmptySettings @IsIn` rejected `__type:"blogger"` and every Blogger publish 400'd; added it (None/setEmpty). A registered-vs-settings cross-check confirmed it was the only missing one (`mastodon-custom` is disabled).
  - **Composer visual bugs (20 undefined CSS classes).** A repo-wide scan (`styles.X` in TSX vs `.X` in the sibling `.module.css`) found the publish-error banner AND the whole validation summary ("Almost there…") AND the entire per-channel provider settings panel referenced classes never defined in `create-post-modal.module.css` → they rendered unstyled. Added all 20 (amber validation card, bordered settings panel + hint/warning/counter, checkbox/select/input controls, styled dismissible error banner); scan now finds **0 missing** across the frontend. Also humanized raw class-validator errors (strip `Posts.0.settings.` path, hide the `__type` provider-list dump).
  - **Settings 401/402/403 fixes.** The api-client now logs out ONLY on **401** (not 403) — a 403 is a permission/plan gate on an authenticated user, and the blanket 403→logout was kicking users off gated settings pages. Storage endpoint no longer 403s org admins in self-host mode (gated on `NEXT_PUBLIC_SELF_HOSTED`, mirroring the nav) + the page fetches `silent`. `GET /settings/team` now needs only `Sections.ADMIN` (not `TEAM_MEMBERS`), so the Users tab no longer 402s on plans without team seats — only INVITING (`POST /settings/team`) stays gated.
  - **Request generator IS the calendar compose form.** Rebuilt `api-request-generator.tsx` to mirror the composer: multi-select channel chips using the real `ChannelAvatar` (picture + platform badge), content editor, date, type, Insert media — but the output is the live `POST /public/v1/posts` curl/JSON, not a publish. New `buildMultiPostBody` emits one `posts[]` entry per selected channel (each with its `defaultSettingsFor(identifier)`); `buildPostBody` delegates to it (spec unchanged + multi-channel specs added). Selected-channel avatars get a white+dark "halo" ring in BOTH the composer and the generator.
  - **Private beta.** Public registration disabled via `DISABLE_REGISTRATION=true` (env, not committed). Blocked server-side for LOCAL **and** Google/OAuth via the shared `AuthService.canRegister` gate (a new OAuth user gets "Registration is disabled" in `loginOrRegisterProvider` before `createOrgAndUser`; existing users still log in via `getUserByProvider`). Login page (`AuthShell` gained an optional `banner`) shows a black top strip + footer directing to the `postsider.com` whitelist; the "Sign in with Google" button is hidden behind a `SHOW_GOOGLE=false` flag.
- **App-wide UI/UX + auth-flow pass (2026-07-07).** Commits `10b46bc` (UI pass) `052b106` (form controls) `40af8d8` (password mins) `686b45f` (review fixes) `2ab4e54` (env docs) on `feat/port-oss-features`. Frontend-only + Docker/env plumbing; no backend/DB changes. **Built + deployed to prod 2026-07-07** (app healthy, 9 containers Up); smoke-tested live: `/forgot` renders (was 404), `/register` shows the whitelist card, `/csv-template.csv` 200, Terms/Privacy on `AuthShell`. Pushed to `feat/port-oss-features`.
  - **Auth flows completed.** Ported `/forgot`, `/auth/forgot/<token>`, `/auth/activate/<jwt>` from `main` (the login "Forgot password?" link 404'd in prod — pages only existed on `main`, never merged into `feat/port-oss-features`) + their `PUBLIC_PATHS` entries. `/register` now shows a private-beta whitelist card instead of a form the server rejects. Terms/Privacy links (`postsider.com/terms`,`/privacy`) on every auth card via `AuthShell`. **Private-beta is now ONE flag** `beta.tsx PRIVATE_BETA = process.env.NEXT_PUBLIC_DISABLE_REGISTRATION==='true'` (banner + register gate + Google-button hide) — replaces the old split `SHOW_GOOGLE`/inline-banner; new build arg wired through Dockerfile/compose/`.env.production` mirroring the server-side `DISABLE_REGISTRATION`. **Password minimums aligned with the backend DTOs (8 chars)** for register/reset/setup — forms validated 6/6/3, so short passwords passed client validation and surfaced a raw class-validator 400 (register-at-6 was a pre-existing bug); login stays at 3 for legacy accounts.
  - **i18n migration (~150 new `en.ts` keys, other locales still fall back to EN).** Full coverage for previously all-English areas: approval, CSV import, caption-templates, hashtag-groups, utm-builder, queue-plan, users/api/storage remnants, Telegram/Farcaster connect modals, billing plan cards (moved out of `billing-api.ts` PLANS), and the whole composer (controls + validation). Wired ~30 already-existing-but-unused keys (delete confirms, empty states, onboarding sources). **Calendar now follows the user locale** (Intl weekday/month names + dates, was hardcoded `en-US`). A repo scan verifies all `t()` literals resolve (**768 keys, 0 missing, 0 bad interpolations**) and **all 218 `t("…" as any)` casts were removed** so keys are compile-time-checked again.
  - **Mobile (was desktop-only).** `dashboard-shell` sidebar becomes a hamburger drawer under 900px (new `dashboard-shell.module.css`, Escape + backdrop close); calendar/analytics stack to one column, week timeline scrolls; all form fields ≥16px on mobile to stop iOS focus auto-zoom (scoped to `@media (max-width:768px)` — a first cut had bumped some to 16px unconditionally and regressed desktop, caught in review).
  - **A11y + native form controls.** Calendar renders load errors (`role=alert` + retry) and a loading state instead of a silently empty grid (only until the FIRST load — later month nav keeps the grid mounted). `role=alert` on every error banner; bespoke modals get `ConfirmDialog` or `role=dialog`+Escape+focus; composer gets autofocus + focus-trap; global `:focus-visible` for classed buttons. `alert()` → styled inline (storage, Google button). `globals.css` brands the browser-native chrome the strict-B&W theme never styled: `accent-color` (black checks/radios), black-on-white `::selection`, muted `::placeholder`, autofill repaint (killed the yellow login autofill), no native search-cancel/number-spinners, grayscale date/time glyphs; composer + API-generator selects get the brand chevron. **Note: the one-time API-key reveal modal is deliberately NOT Escape-closable** (key shown once) — an over-eager Escape handler that dismissed it was reverted in review.
  - **Reviewed** by two multi-agent workflow passes (frontend diff, then a partial social-providers pass): 8 verified defects fixed (above). Cross-check scripts (`scratchpad/*.py` — throwaway) confirmed no Blogger-class registration gaps remain and surfaced provider env keys missing from `.env.production.example` (`GOOGLE_GMB_CLIENT_ID/SECRET`, `INSTAGRAM_APP_ID/SECRET`, `TWITCH_CLIENT_ID/SECRET`, `WHOP_CLIENT_ID`, X flags) — now documented. **Open follow-ups:** translate the new keys into `pl.ts` (+ rich-interpolation for the sentence-fragment keys like `legalPrefix`/`switchLocal*`); the Lemmy/Farcaster `settings.subreddit` field is a naming leftover from the removed Reddit provider (works, DTOs consistent); the social-providers review was cut short (session limit) and only the scriptable cross-checks completed.
- **App-review prep + connect-picker fix + Temporal-worker outage (2026-07-14 → 07-19).** Two backend features + one bugfix, all **built + tested (132 root tests green) + deployed to prod 2026-07-19**, committed + pushed 2026-08-05 as part of `ef5f793`.
  - **Meta platform-compliance callbacks.** New `apps/backend/src/api/routes/meta.compliance.controller.ts` (registered in `api.module.ts`, public — no auth): `POST /meta/data-deletion/:app` and `POST /meta/deauthorize/:app` for `:app ∈ facebook|instagram|threads`. Verifies Meta's `signed_request` (HMAC-SHA256 with the app secret, timing-safe, base64url, checks `algorithm`), then wipes/soft-deletes the platform user's channels via new `IntegrationService.wipeIntegrationsForPlatformUser` / `deauthorizeIntegrationsForPlatformUser` + repo `findByPlatformInternalIds`/`dataDeletionWipe`/`markDeauthorized` (cross-org lookup by `rootInternalId`/`internalId`; FB app matches both `facebook-`/`instagram-` id prefixes). Data-deletion returns `{url, confirmation_code}` (deterministic code so Meta retries match); `url` = new env **`DATA_DELETION_URL`** (cloud: the `postsider.com/data-deletion` landing) with a built-in `GET /meta/data-deletion/status` HTML fallback for self-host. Live-verified: bad signature → 403, unknown app → 404, status page → 200.
  - **`docs/APP_REVIEW_CHECKLIST.md`** — per-platform review steps (Meta ×3, Google/YouTube, Pinterest trial→standard, TikTok audit, LinkedIn, X) with the exact callback/redirect URLs. Review-readiness audit findings baked in: all target OAuth providers have complete OAuth+publish; **gaps are compliance-side, mostly landing/console work (owner):** landing needs a `/data-deletion` page (was 404) + a Google "Limited Use" clause in the privacy policy; **GMB provider has no own creds and falls back to `YOUTUBE_CLIENT_ID/SECRET`** so `business.manage` widens the YouTube app's verification scope — split it out or disable GMB before Google review; **LinkedIn scope mismatch** (code wants `r_basicprofile`+`w_member_social`; `docs/INTEGRATION_SETUP_GUIDE.md` says `openid,profile,email` — that guide is also stale on Gmail/YouTube scopes); privacy policy doesn't name "Instagram".
  - **Connect page-picker broken-image fix.** After Facebook OAuth the page-picker (`oauth-callback.tsx`, "Choose which page") showed broken thumbnails because `facebook.provider.ts pages()` returned raw Graph objects with `picture: { data: { url } }` (an object) while the client renders `<img src={page.picture}>` (`ConnectPage.picture` is a `string`) → `"[object Object]"`. Normalized `pages()` to `{id, page, name, username, picture: string}` — which **also closed a token leak** (the raw objects carried each page's `access_token`, sent to the browser; the connect step re-fetches server-side from the page id so it was unused). Same nested-`picture` bug fixed in `instagram.provider.ts pages()`. Frontend also got an `onError` fallback to the letter-avatar (FB CDN picture URLs are time-limited and expire). LinkedIn Page was already correct (flat `picture` string). Needs a human to re-run the FB connect flow to confirm visually.
  - **Temporal-worker outage incident (root cause; all three durable fixes landed 2026-07-22, see the next bullet).** Symptom "can't publish to Threads" was actually **all publishing dead for ~10 days**: after the 2026-07-08 container boot the orchestrator's Temporal **worker** connection hit `ConnectionRefused` (startup race — it connected before `postsider-temporal` was ready) and the factory returned `null` instead of retrying, so the Nest process came up healthy (`/health` on :3002 green, so the monitor stayed silent) **with zero workers polling** — scheduled posts piled up in `QUEUE`. Diagnosis signature: post stuck in `QUEUE` past `publishDate` with NO `error` (a real API reject sets `state=ERROR`); `temporal task-queue describe` shows **0 pollers**; `main` queue backlog aged ≈ boot time. Compounding trap: a plain `pm2 restart orchestrator` **orphaned** the old `node` (pm2 runs it via a `pnpm start` wrapper that doesn't forward SIGTERM), and the orphan kept `:3002`, so new incarnations crash-looped on `EADDRINUSE`. **Fix that worked: full `docker compose … up -d --force-recreate postsider` (clean process table; Temporal already healthy so no race).** Publish workflow `postWorkflowV105` runs on task queue **`main`** (platform id is just an activity arg), so once workers repolled the backlog drained itself. **Durable follow-ups (ALL DONE 2026-07-22):** (1) run orchestrator as `node` directly in pm2, not via `pnpm`, so restarts don't orphan; (2) harden worker startup vs the Temporal race (`depends_on: service_healthy` + retry/crash instead of silent `null`); (3) monitor a real "worker is polling" signal, not just HTTP 200 (this exact gap hid a 10-day outage — mirrors the VPS runbook's known `CONTAINERS`/temporal monitoring hole).
- **Reliability + i18n session (2026-07-22). All committed AND DEPLOYED 2026-07-22** (in the App-security session below — prod moved off the 07-19 image; the "old behaviour" warnings in this entry are now historical, not live). Nine commits `1ce47cd`…`d4de924`: the 07-19 Meta-compliance batch that was sitting uncommitted, then the three durable follow-ups from the 07-08 silent outage, then a 36-finding silent-failure audit and its fixes, then i18n for every locale. Backend + orchestrator + frontend build clean; 132 root tests green; the production image was rebuilt and smoke-tested (uid=postsider, all three pm2 script paths resolve, nginx starts unprivileged, `pnpm exec prisma` works offline). Full audit report is kept OUT of the repo at `~/postsider-audyt-2026-07-22.md` (it contains security findings; this repo is public).
  - **pm2 supervises `node` directly** (new root `ecosystem.config.js`, replaces the per-app `pm2` scripts). pm2 used to supervise a wrapper FOUR levels above the real process (`pm2 -> pnpm -> sh -c -> dotenv -> node`), verified live on prod: pm2 held pid 201 while the actual worker process was pid 270. That is why `pm2 restart` orphaned the old `node` and the replacement crash-looped on `EADDRINUSE`. The `dotenv -e ../../.env` wrapper was pure overhead in the image anyway (`/app/.env` does not exist; env arrives via compose `env_file:`). The Dockerfile CMD now `exec`s `pm2-runtime` instead of routing through `pnpm run pm2`, so tini's SIGTERM reaches the supervisor. Pair it with compose `stop_grace_period: 45s` — without that the default 10s SIGKILLs the container before the orchestrator's 35s `kill_timeout` drain can finish, making the kill_timeout physically unreachable.
  - **The startup race is closed at three levels.** (1) `temporal` finally has a healthcheck and `postsider` `depends_on` it — the probe describes the `default` namespace rather than opening a socket, because auto-setup registers the namespace only *after* it accepts connections, and it must address `$(hostname -i):7233` since the server does not bind `::1`. (2) `getTemporalModule` passes `allowConnectionFailure: false` when `isWorkers` — the library default made `TemporalWorkerManagerService` log a warning and `return` on a failed connection, which is literally how the app booted "healthy" with zero workers (`temporal-worker.service.js:147`, and `temporal-connection.factory.js:150` swallows the error with no retry at all, unlike the client path next to it which retries 3x). The client side keeps the lenient default so a Temporal blip cannot take the backend down. (3) `apps/orchestrator/src/main.ts` waits for Temporal (retry/backoff, 5 min cap, `TEMPORAL_WAIT_TIMEOUT_MS`) *before* `NestFactory.create`, and `bootstrap()` exits non-zero instead of leaving an unhandled rejection.
  - **Health endpoints now describe THIS process, not the server.** `GET /health/workers` (orchestrator) reports per-task-queue worker state and 503s when any worker is not polling — especially `main`, where every publish workflow runs. Backend `/health` gained a Temporal check and now returns **503 when degraded** (it used to answer 200 with Redis or the DB down, so code-only monitors saw green). The container healthcheck probes all three (`/` + `/api/health` + `:3002/health/workers`, `start_period: 180s`); it used to probe the frontend alone, so backend and workers could be dead while the container reported healthy.
  - **RUN_CRON was unset in prod → `missingPostWorkflow` (the hourly stuck-post recovery sweep!), `evergreenWorkflow` and `mediaCleanupWorkflow` had NEVER run** (verified against live Temporal — zero executions ever). Now set in `.env.production`, documented in `.env.production.example`, checked strictly (`=== 'true'`, was truthiness so `RUN_CRON=false` would have ENABLED them), registration retries 20x15s with loud logs (was three empty catches). Sweep window widened 2d→14d; all three crons survive activity failures (try/catch per iteration, was `while(true)` that died forever on 3 consecutive errors) and `continueAsNew` to bound history.
  - **Backend twin of the worker outage fixed:** `posts.service.startWorkflow` marks posts ERROR + rethrows when the publish workflow cannot be scheduled (was: `?.` no-op on a null client + empty catches → HTTP 200, post QUEUE forever, `error` null). The publish workflow's refresh_token-exhaustion path records ERROR (was: workflow "Completed", post QUEUE, no error — invisible even with healthy workers); `isCommentable` got the orphaned-provider guard `postSocial` already had; `getPost` is null-safe.
  - **Token-refresh arming retries for ~10 minutes** (20 rounds, only the integrations that failed, loud error listing unarmed ids). It used to give up after 30s with one `console.log`, so a Temporal still starting left EVERY channel un-armed until the next redeploy and idle channels quietly let their tokens lapse.
  - **Polar webhook map-misses now throw → 5xx → Polar retries** (was `{ok:false}` → 200 = recorded as delivered, never retried; a paying customer silently stayed FREE). Expired trials are filtered in `getSubscription` too — the publish gate used to honor a trial the rest of the app already treated as FREE.
  - **Uploads capped** — multer `limits.fileSize` via `upload.limits.ts` (`MAX_UPLOAD_MB`, default 512M) on all four endpoints, matching nginx (container AND host) lowered 2G→512m. Multer buffers in heap, so one large multipart request could OOM the container.
  - **deploy.sh hardened:** INT/TERM traps (the MAINTENANCE flag leaked on interrupt and MUTED THE MONITOR FOREVER — the host monitor now also has a 45-min TTL on the flag), pre-deploy `pg_dump`, `:prev` rollback tag, health-timeout is a hard failure (was warn + "Deploy complete." over a dead deploy), post-deploy builder/image prune (~9GB reclaimed at introduction), TTY-safe bootstrap.
  - **Image + compose hardening:** `USER postsider` (everything ran as root; `PM2_HOME=/app/.pm2`), `prisma` moved to dependencies + `pnpm exec` for boot migrations (was `pnpm dlx` = an npm-registry dependency in the incident-recovery path), ecosystem `max_memory_restart` per app, minio-init `&&`-chained + `service_completed_successfully` gate, minio/mc/dbgate pinned by digest, Redis `allkeys-lru` → `volatile-lru` (every key has a TTL today, but silent eviction of `organization:<state>` mid-OAuth can fork a reconnect into a duplicate channel).
  - **Host-side, already live (no deploy needed):** monitor watches Temporal pollers on `main` **and** posts stuck in QUEUE past `publishDate` with no error; `CONTAINERS` 6→12; MAINTENANCE TTL; expiry-alert dedup keyed on id+band instead of the exact expiry timestamp (a token rotating hourly used to re-alert every rotation), with entries cleared once a token is healthy again or its integration is gone. Host nginx got HSTS/nosniff/Referrer-Policy (**no** X-Frame-Options — Whop embeds the app in an iframe), `server_tokens off`, 512m body cap, proper `map $http_upgrade` idiom. A repo-local gitignored `.env` pins `COMPOSE_FILE=docker-compose.production.yaml` (a bare `docker compose up -d` used to grab the DEV compose file: same container names, EMPTY volumes, 0.0.0.0 ports bypassing UFW).
  - **Deliberately NOT changed:** `IntegrationsActivity.refreshToken` did not get `@ActivityMethod()`. It was never registered, so `refreshTokenWorkflow` has always executed `PostActivity.refreshToken` via name collision; decorating it would silently SWAP implementations. The dead method was removed and the workflow proxy retyped to `PostActivity` instead.
  - **i18n: 11 catalogs × 768 keys.** Every locale was stuck at 323/768, so everything added since the OSS port fell back to English outside EN. Each was translated against its own existing catalog so register carries over (formal Sie/vous/siz/вы, ですます, 합니다체, pt-BR, Simplified zh). Verified mechanically, not by eye: key parity, placeholder parity (0 mismatches), and concatenation safety. **The concatenation check is the one to keep:** a dozen keys are sentence fragments the JSX joins around a `<code>` chip or a link — most with an explicit `{" "}`, but the webhooks delete-confirm with NO separator (`${prefix} "${name}"${suffix}`). Validating against the real render sites caught three pre-existing bugs (pl/pt/ru rendered `Authorization :`, pl rendered `.env , a następnie`, zh had a space before a full-width comma) and confirmed CJK correctly keeps its particle attached to the quoted name. Also stripped em-dashes from 6 pre-existing keys across all 10 translated catalogs (53 strings) — `en.ts` uses commas/full stops there. Dead `settingsMcp` keys removed everywhere.
  - **Historical open list:** merge, LinkedIn reconnect, and Sentry setup were completed later. Still relevant are external app-review tasks, UptimeRobot verification, and offsite backup/MinIO restore. Neighbor stack, out of scope but worth knowing: n8n is capped at 4g/2 CPUs in the current VPS configuration.
- **App-security review + full deploy (2026-07-22, session 2).** The reliability/i18n/Meta batch above and a new security pass over the app features are **now LIVE** — prod moved off the 07-19 image over several health-gated `--no-build` deploys (`RUN_CRON` active, app runs as `postsider`, Redis `volatile-lru`, storage locked; 32/32 workers + pollers on `main` verified after each). All commits pushed to `origin/feat/port-oss-features` 2026-08-05 (`ef5f793`).
  - **🔴 Storage bucket was anonymously LISTABLE.** `minio-init` used `mc anonymous set download`, which grants `s3:ListBucket` to `*` — `GET https://storage.postsider.com/?list-type=2` dumped every object key across all orgs. Fixed live (`mc anonymous set-json`, GetObject-only) **and** durably: `minio-init` now mounts `minio-anon-policy.json` and applies it. Objects stay public-read by design (platforms fetch by URL), so the random object key is the only per-object protection — anonymous listing is what exposed everything.
  - **Incident: `crypto` in the workflow bundle (see the new Conventions note).** A "crypto storage keys" change made `makeId` import `crypto`; `makeId` is called inside `post.workflow.*`, Temporal's deterministic sandbox forbids the module, so the orchestrator crash-looped → publishing dead for a few minutes. Caught by `/health/workers` (the docker build PASSED — the workflow bundle builds at orchestrator startup), rolled back to `:prev`, recovered; `makeId` reverted to `Math.random`. Every later deploy stayed health-gated with `:prev` as the rollback tag.
  - **HIGH (deployed).** (1) `inviteTeamMember` reset AND disclosed the global password of an existing user who belonged to ANOTHER org = cross-tenant account takeover → now link/re-enable only, credentials untouched (removed `resetUserForReinvite`). (2) `sendWebhooks` raw-`fetch`ed stored webhook URLs (DNS-rebinding SSRF to internal IPs) → routed through `ssrfSafeDispatcher` (dynamic `import()` keeps undici out of the bundle). (3) `getApprovedApps` echoed the OAuth `clientSecret` + the authorization `accessToken` to the third-party authorizer → stripped, mirroring `getApp`. (4) public `getComments` returned internal comments with `userId`/`organizationId` and soft-deleted rows → `select` id/content/createdAt + `deletedAt: null`.
  - **MEDIUM (deployed).** Removed dead `POST /public/modify-subscription` (unauthenticated any-org plan mutation, guarded only by a non-expiring `JWT_SECRET` HMAC, no minter anywhere). `POST /enterprise/create-user` now requires the full `{id,name,saasName,email}` payload — session tokens (verified with the same shared `JWT_SECRET`) lack `saasName`, blocking replay into a self-provisioned ULTIMATE org. Public `GET /public/posts/:id` preview no longer returns the internal `error` field.
  - **Verified clean:** approval (`/approval/*` — every repo query org-scoped, `assertCanApprove` requires ADMIN/SUPERADMIN, `getById`/`getPost` fail closed cross-org); analytics org-scoped; **`auth.middleware` re-resolves the user from the DB and `req.org` can only be one of the caller's own orgs** — the tenant-isolation linchpin, confirmed sound.
  - **NOT done / deferred / owner:** outbound-webhook **HMAC signing** (needs a `Webhooks.secret` migration + UI); a **share-token gate** for `/public/posts/:id` and whether comment CONTENT should be public at all (product decisions); crypto storage keys as an **activity-isolated** helper (low — listing already closed); **self-host RBAC bypass** — `permissions.service.check` grants ADMIN to every member when `!isBillingEnabled()` (self-host ONLY; this prod has billing on, so NOT affected). These are deferred product/security decisions, not blockers for the current private beta.
- **CodeRabbit full-review pass (2026-07-31).** Applied the complete CodeRabbit report (**260 findings**, generated against `main` via a `coderabbit-review-snapshot` branch) to `feat/port-oss-features` — commit `57dfd20`, **106 files, +1484/−630**. Verified: backend + orchestrator + frontend builds green, **127 root + 27 MCP tests** green. Highlights:
  - **Security:** OAuth `process.env` credential injection is now **serialized per provider** (`ProviderEnvHelper` per-provider async mutex) — closes the cross-tenant credential race that was open issue #2 (chose serialization over the full pass-creds-explicitly refactor; the connect controller now routes through `ProviderEnvHelper` instead of duplicating the env swap); wallet/Farcaster `getUser` returns `false` per the provider contract (was a truthy `{id:'',email:''}` → could create blank accounts); **wallet challenge is single-use** (consumed on first verification, no replay); `/user/setup` gated to the bootstrap `admin@setup.local` account + service-layer write + email-uniqueness; PKCE state guard made reachable (the `|| 'none'` fallback is gone); Chrome-extension refresh persists `customInstanceDetails` via `encryptSecret` (was `signJWT`); **cross-tenant post-group soft-delete scoped by `organizationId`**; **WordPress SSRF** (server-side domain validation + `ssrfSafeDispatcher` on every fetch); webhook delivery via `ssrfSafeDispatcher` + 5s timeout; CSRF `NOT_SECURED === 'true'` + Origin allowlist normalized; permissions guard fails closed on missing org/role; webhook grant honors the requested action; GitHub OAuth picks primary/verified email; `NEXT_PUBLIC_SELF_HOSTED === 'true'` storage gate; provider-cred GET returns `hasClientSecret` (no secret prefix); delete-account requires SUPERADMIN; `GET /settings/post-checker` ADMIN-gated; Sentry redaction uses substring matching; request-id echoes only well-formed ids; throttler falls back to client IP; remote media downloads bounded (timeout + size cap) in all storage providers; `/activate`, `/resend-activation`, `/forgot-return`, `/oauth/*/exists` now rate-limited.
  - **Providers:** every unbounded status-poll loop capped (bluesky, facebook, instagram, pinterest, tiktok, threads, whop, x); failed publishes no longer reported as success (slack, mataroa, notion, writeas, medium, x, listmonk, twitch); Nostr hex→bytes + canonical event id + relay-accepted check; **Mastodon-custom resolves its instance from `customInstanceDetails`** (was posting to mastodon.social); Dribbble `refreshToken` no longer leaks tokens to Pinterest; LinkedIn multipart uses per-chunk instruction URLs; Instagram media URLs URL-encoded; TikTok validity uses `hasExtension`; FB error matched as `"code":490`; Telegram bot built lazily + setTimeout rejection handled.
  - **Backend/libraries:** `/health` Redis/DB checks time-boxed; public proxy returns the upstream status; enterprise `webhookUrl` validated as http(s); refresh sweep `continue` (not `return`); `startRefreshWorkflow` gates on the stored refresh token; `NotEnoughScopes` extends `ApplicationFailure` (non-retryable in Temporal); webhook create is transactional + links only org-owned integrations; last SUPERADMIN can't be removed; unknown subscription tier → FREE; recurring expansion bounded; notifications exclude soft-deleted rows; short-URL domain regex `/g`; `local.storage` crypto-random names; r2 multipart success now responds (was hanging the client); MIME allow-lists unified with `mime.types.ts` (`custom.upload.validation` + r2 now accept webm/mov/mkv/audio).
  - **Frontend:** api client no longer double-prefixes the backend URL (`/api/api`); 403 no longer logs the user out; approval per-item busy set + reject-note reset; calendar guards stale responses; settings email field syncs after async load; queue-plan empty-day semantics; evergreen/UTM numeric clamps; webhook/API revoke busy states; PDF captures the invite's role.
  - **Deliberately left open (do not "fix" blindly):** migration `20260628160000` enum narrowing (open issue #1, checksum — do not edit); global throttler default 9999/hour (deliberate in both branches; real limits live in `AuthRateLimitGuard`/`ApiRateLimitGuard`); email templates not HTML-escaped + passwords-by-email (product decision); `media.service` unbounded delete (needs a workflow); plaintext secret columns in schema (envelope encryption); `/register` still echoes `e.message`; short-linking providers (dub/short.io/linkdrip/kutt); `inbound.registry` `as any` reach-in; csv-import limits; OAuth redemption TOCTOU; trial check-then-act.
  - **Historical follow-up:** merge, LinkedIn reconnect, and Sentry configuration were completed after this audit entry. The Facebook picker still benefits from a fresh manual visual check if that flow is changed again.
- The 11 differentiator features: composer helpers (hashtag groups / caption templates / UTM), posting queue (day-aware find-slot), bulk CSV import, approval workflow, per-platform preview, AI caption rewrite, API request generator, Post Checker, Evergreen, Smart Slots, first-comment.

## Commands

```
pnpm run build:backend            # nest build (full typecheck)
pnpm --filter ./apps/frontend run build
pnpm run build:orchestrator
pnpm --filter @postsider/mcp build   # MCP server (apps/mcp)
pnpm test                         # root jest (excludes apps/mcp); feature units: jest.*.config.cjs
NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs   # MCP server tests
pnpm run prisma-generate          # after schema.prisma changes
pnpm run dev:docker               # Postgres/Redis/Temporal containers
pnpm run dev                      # backend (:3000) + orchestrator (:3002) in parallel
pnpm run dev:frontend             # :4200
```

## Run modes (one codebase, env-gated)

Cloud and self-host are the SAME build; env vars switch behavior. Helpers: `isBillingEnabled()` (`services/billing.flag.ts`), `isPlatformAiEnabled()` (`services/ai.flag.ts`).

- **Billing is Polar-only.** `isBillingEnabled()` returns `!!process.env.POLAR_ACCESS_TOKEN`. Set (cloud): plans gated, 402 responses carry a `section` for plan-limit messaging. Absent (self-host): every org is unlimited. Stripe was **fully removed** (this session); billing is Polar-only via `PolarService`. **Trial:** with billing on, a first-time signup gets a real 7-day STANDARD Subscription (`identifier='trial'`, `cancelAt=+7d`); `getSubscriptionByOrganizationId` returns null once it expires so the org falls back to FREE (see Status "Trial…" bullet).
- **AI is platform key OR BYO key.** `OPENAI_API_KEY` set (cloud): Post Checker + rewrite use `OpenaiService.complete()`. Absent (self-host): they fall back to a per-org BYO key stored in `ProviderCredentials` (`post-checker` namespace); `/settings/post-checker` page + config endpoints appear only in self-host; `/posts/check` + `/posts/rewrite` return 409 until a key is saved.
- **No other AI (Postiz AI stripped).** All inherited Postiz AI was removed: agent (LangGraph), agent-bridge, MCP/chat server + tools (`/settings/mcp`), copilot, autopost, AI image/video/slides gen (fal, veo3, heygen), voice, `agent-media.ai` SSO. `OpenaiService` exposes ONE method (`complete()`). The two non-AI `chat/` helpers (`@Rules` decorator, `validation.schemas.helper.ts`) stay. Orphaned stripped-AI Prisma models (`AutoPost`, `AgentToken`, `mastra_*`) + dead enum values + `Organization.hitlMode` were removed in migration `20260628160000_remove_stripped_ai_models`. Do not re-add the inherited Mastra agent. **MCP is back, but as a NEW lean server in `apps/mcp` (`@postsider/mcp`) wrapping the public `/public/v1` API for AI agents (only deps: `@modelcontextprotocol/sdk` + `zod`) — keep it; it is NOT the removed inherited Mastra MCP.**
- **Social OAuth via per-provider env.** Each `integrations/social/*.provider.ts` reads its app id/secret from env. Cloud sets PostSider's; self-host operators set their own (see `.env.example`). There is no paste-in-UI modal.
- **Custom connect flows (2 providers).** Most providers connect via OAuth redirect (`oauthUrl`) or a manual `customFields` form. Two need a bespoke client flow, branched in `calendar.tsx addChannelForPlatform` BEFORE the customFields fallback, each with its own modal reusing `custom-fields-modal.module.css`: **Telegram** (`TelegramConnectModal`) shows `/connect <code>` and polls `GET /integrations/telegram/updates?word=<code>`; backend `getBotId` matches the code in `getUpdates` — one shared bot (`TELEGRAM_TOKEN`), added as channel admin (NOT per-user bots; `getUpdates` is single-consumer so not safe for many simultaneous connects). **Farcaster/wrapcast** (`FarcasterConnectModal`) loads the official SIWN widget (`neynarxyz.github.io/siwn`); `get-oauth-url` returns `neynarClientId`, the SIWN callback's `{signer_uuid,fid,user.*}` is flattened to the snake_case payload `authenticate()` decodes; needs `app.postsider.com` as a Neynar **Authorized origin**. Env: `TELEGRAM_TOKEN`/`TELEGRAM_BOT_NAME`, `NEYNAR_CLIENT_ID`/`NEYNAR_SECRET_KEY`.
- **Migrations, NOT `db push`.** Ships Prisma **migration files** (`libraries/nestjs-libraries/src/database/prisma/migrations/`); the server (cloud and self-host Docker) runs `prisma migrate deploy` on boot. Generate new ones with `migrate dev`. Never commit a `db push`-only schema change.

## Deploy notes (Docker self-host)

- `sudo ./deploy.sh` builds the image, recreates the stack, and runs `prisma migrate deploy` on boot (health-gated, ~3 min after build). `--bootstrap` is **first-install only** (creates the first admin) — for an existing DB use plain `deploy.sh`. `--no-build` restarts after an `.env.production`-only change. `ENCRYPTION_KEY` must be set (provider tokens/secrets are AES-256-GCM at rest; `decryptSecret` is version-aware so legacy CBC values keep working).
- **Compose project name = working-dir name = volume prefix.** Don't rename the deploy directory, or the data volumes (`<dir>_postgres-data`, `_minio-data`, `_redis-data`, ...) orphan and the stack comes up empty. Take a `pg_dump` + `.env.production` backup before any migration-bearing deploy.
- **Dockerfile / pnpm hoisted linker.** `.npmrc` sets `node-linker=hoisted`, so every third-party dep lives in the ROOT `node_modules` and `apps/frontend/node_modules` is never created (the frontend has no `workspace:` deps). Do NOT `COPY apps/frontend/node_modules` in the runtime stage — it aborts the image build with `not found`; `next start` resolves deps from the hoisted root via Node's upward module resolution.
- **`postsider-app` memory limit is 3072M** in `docker-compose.production.yaml`. The orchestrator bundles one Temporal worker per platform task-queue in a single node process; startup peak is ~2.5GB. Lower limits (1280M/2560M) OOM-kill mid-boot and crash-loop, leaving scheduled posts stuck in `QUEUE` (looks platform-specific but hits every platform). Durable follow-up: bundle the workflow once (`bundleWorkflowCode` + `workflowBundle`) instead of ~40x.
- **`NOT_SECURED` must stay UNSET in production** — the code checks truthiness, so even `"false"` enables insecure mode (no session cookie -> login fails). Keep it commented out in `.env.production`.
- **Publishing stopped but app "healthy"? Suspect the Temporal workers, not the platform.** All publishing runs through the orchestrator's Temporal workers (in the `postsider-app` container, pm2 process `orchestrator`, health on :3002). If they fail to start, the app still reports healthy and scheduled posts pile up in `QUEUE` with NO `error` (an API reject would set `state=ERROR`). Diagnose: `docker exec postsider-temporal temporal task-queue describe --task-queue main --address <temporal-ip>:7233` — **0 pollers** = workers down; a `main` backlog aged ≈ last boot confirms it. Since 2026-07-22 the VPS monitor watches exactly this and alerts, and the orchestrator exposes `GET /health/workers` (503 when a worker is not polling) — `/health/status` and the container healthcheck do NOT cover it. Seen 2026-07 after a boot where the worker connection lost a startup race with `postsider-temporal` (`ConnectionRefused` → factory returned `null`, no workers); the race and the silent-`null` are fixed in the 2026-07-22 pass. **On any image built before 2026-07-22, do NOT reach for `pm2 restart orchestrator`** — pm2 ran it via a `pnpm start` wrapper that doesn't forward SIGTERM, so the old `node` orphaned, kept `:3002`, and new incarnations crash-looped on `EADDRINUSE`; recover with a full `docker compose … up -d --force-recreate postsider` instead. From that image on, pm2 supervises `node` directly and `pm2 restart orchestrator` is safe.

## Conventions (shared with OSS)

- Backend modules register in `apps/backend/src/app.module.ts` (global libs) / `apps/backend/src/api/api.module.ts` (`authenticatedController`); DB services in `database.module.ts` (`get exports()` mirrors `providers`). `OpenaiService` is provided by the global `DatabaseModule`.
- Controllers use `@GetOrgFromRequest() org`; role on `org.users[0].role`.
- **Scheduling is UTC.** `PostsService.findFreeDateTime(orgId, integrationId?)` returns a UTC wall-clock string without a zone; callers needing an instant append `'Z'`. `Integration.postingTimes` is `[{time, days?}]` minutes-from-midnight UTC; queue slot search is day-aware (`queue-slots.ts` `slotsForDay` + 365-day guard in `findFreeDateTimeRecursive`).
- **Public API auth is the RAW `Authorization` header** (no `Bearer`); `getOrgByApiKey(auth)` on the whole value. Base `/public/v1`.
- First comment: optional per-post `firstComment`, persisted on the main post row, published best-effort by the publish workflow (`post.workflow.v1.0.5`) for comment-capable providers (`integrations/social/comment.capability.ts`).
- Recurring jobs (Temporal): activity class + self-looping workflow, registered in `apps/orchestrator/src/app.module.ts` `activities` + exported from `workflows/index.ts`, started in `InfiniteWorkflowRegister` gated by `process.env.RUN_CRON` (e.g. `evergreenWorkflow`).
- **Workflow code runs in Temporal's deterministic sandbox — no node-only module imports.** Anything reachable from `apps/orchestrator/src/workflows/` (even transitively — `makeId` in `services/make.is.ts` is imported by `post.workflow.v1.0.x` for the `workflowId` suffix) must NOT import `crypto`/`undici`/other node-only modules. `Math.random` IS allowed (Temporal patches it to be deterministic); the `crypto` MODULE is hard-blocked. The workflow bundle is built at orchestrator **startup**, so a bad import passes `docker build` and only crash-loops the orchestrator at boot — `/health/workers` catches it, the build does not (learned the hard way 2026-07-22). A crypto/secure-random helper for non-workflow use (storage keys, tokens) must live in activity/service code only, and reach it via a dynamic `import()` if the file is anywhere near the workflow graph.
- **NEVER edit a running workflow function in place — always create a NEW version.** Running workflows replay against the code from their start time; adding/removing/reordering commands inside an existing `post.workflow.v1.0.x` (e.g. inserting `claimPostForPublish` between `getPost` and `sleep`) makes their recorded history non-deterministic → `WorkflowTaskFailed` on the next timer-fire, posts silently stuck in QUEUE with no error (2026-08-24 incident, fixed by restoring V105 + moving the change to V106). To change the publish pipeline: copy to `post.workflow.v1.0.N+1.ts`, rename the function + its `startChild`, export from `workflows/index.ts`, and point `posts.service.ts startWorkflow` + `post.activity.ts searchForMissingThreeHoursPosts` at the new version string. Old workflows keep publishing on the old version; new posts use the new one.
- Frontend: `@/lib/api` `api.{get,post,put,del}`; settings pages mirror `app/settings/api/page.tsx` and use `settings-ui` (`PageHeader`, `Card`, `settingsStyles`); nav in `settings-shell.tsx` / `dashboard-shell.tsx` `NAV_ITEMS`; i18n `lib/i18n` (`en.ts` authoritative, other locales fall back). The api-client auto-logs-out ONLY on **401** (never 403 — a 403 is a permission/plan gate the calling page must handle); pass `{ silent: true }` to opt a call out of global error handling.
- Brand/copy: B&W Apple-minimal; **no em/en-dashes in rendered copy** (LLM-facing prompt text is exempt).

## Notes

- **Smart Slots ("best time")** lives in `libraries/.../smart-slots/`: `smart-slots.heuristics.ts` is a per-platform gradient peak-hour table (every registered provider), blended by `scoreSlots` with the channel's posting-rhythm histogram (hours of its own PUBLISHED posts, gated `>= 8`); the service collision-avoids against `QUEUE` posts and diversifies to one suggestion per local day. It is NOT engagement-driven — no post analytics are persisted, so the `clickHistogram` blend uses posting rhythm, not engagement. Wiring engagement (a `PostAnalytics` model + a stats cron) would make it data-driven; the `clickHistogram` hook is ready.
- **YouTube analytics is intentionally broken** by the scope trim: `yt-analytics.readonly` was removed to match the Google console, so `youtube.provider.ts analytics()` 403s ("insufficient scopes"). Posting is unaffected (covered by `youtube.upload`/`force-ssl`/`readonly`); `checkAnalytics` catches the error → empty. To restore channel analytics, add `yt-analytics.readonly` in BOTH the console and `youtube.provider.ts scopes`.
- **Threads first-comment needs `threads_manage_replies`** — re-added to `threads.provider.ts scopes` (provider does no `checkScopes`, so it is safe), but it is only granted if the Meta app has that permission approved; newly-connected accounts pick it up on reconnect.
- **Known open issues (2026-06-30 review, left OPEN by design).** (1) For upgrades from live Postiz data, run the documented preflight remap in `DEPLOYMENT.md` or `docs/PRODUCTION.md` before `migrate deploy`; otherwise migration `20260628160000` can abort on legacy `Post` rows holding `MCP`/`AUTOPOST`. Do NOT edit the applied migration (Prisma checksum). (2) `provider-env.helper.ts withCredentials` injects per-org OAuth creds via global `process.env` (mutate-then-restore), a race for two concurrent BYO self-host orgs on the same provider; cloud (platform keys set globally, so `withCredentials` short-circuits) is unaffected. Real fix: pass creds explicitly into provider calls.
- `streakWorkflow` / `digestEmailWorkflow` null-guard (org null for orphaned/deleted orgs) was **fixed this session** (`if (!org) ...` guards added).
- MCP self-host base URL: the public API is served under `/api` behind nginx, so set `POSTSIDER_API_URL=https://<domain>/api` (default `https://api.postsider.com`).
- **`pages_video_upload` NIE ISTNIEJE.** Dwa razy w sesji 2026-08-19 przyszło zadanie
  "dodaj brakujący scope `pages_video_upload`, bo przez to nie działa wideo na FB".
  Tego uprawnienia nie ma w Meta Permissions Reference ani w dokumentacji
  `/{page-id}/videos`. Sprawdzone na żywym tokenie (`debug_token`): wszystkie 6
  scope'ów z `facebook.provider.ts` JEST przyznanych, granularnie do tej strony,
  rola na stronie pełna (`CREATE_CONTENT`, `MANAGE`). Prawdziwa przyczyna
  `(#100) No permission to publish the video` to **Standard Access** — Meta blokuje
  `/{page-id}/videos` z `published:true` dla appek bez Advanced Access, niezależnie
  od roli testera. Dokumentacja Meta: wideo na Page wymaga `pages_manage_posts` +
  `pages_read_engagement` + `pages_show_list`, czyli tego, co appka już ma.
  Rozwiązanie = App Review, NIE zmiana w kodzie. Nie dodawać martwego scope'a.
- **Latencja publikacji na Instagramie to był NASZ bug, nie API Meta.** Pętla
  pollingu kontenera robiła `await timer(30000)` na KOŃCU każdej iteracji, także
  tej, w której status był już `FINISHED` — a zdjęcie jest gotowe w 1-3 s. Karuzela
  przechodzi przez dwie takie pętle = ~60 s martwego czekania. Zmierzone na
  produkcji: **IG 70-105 s vs X 3-6 s** od zaplanowanej godziny. Zastąpione
  wspólnym `waitForContainer()` (wyjście od razu po zmianie statusu, interwał 2 s
  z narastaniem do 30 s, budżet ~20 min zachowany na wideo).
  **Niezacommitowane i NIEZDEPLOYOWANE** — build+testy przechodzą.
