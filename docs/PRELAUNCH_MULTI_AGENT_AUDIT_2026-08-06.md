# Multi-persona pre-launch audit — 2026-08-06

4 agenty, 4 persony, live prod (`app.postsider.com` / `api.postsider.com`), disposable tester accounts + seeded fake channels, wszystko posprzątane po fakcie (0 wierszy testowych zostało w bazie, 4 hasła testerów zrotowane na losowe).

Persony: **Marta** (właścicielka agencji, 15 klientów) · **Dev** (backend engineer, ocena Public API) · **Ren** (automation/RevOps, pipeline n8n) · **Jules** (GTM engineer, użycie dzień-po-dniu).

## Bugi znalezione (realne, nie subiektywne)

**KRYTYCZNY — self-serve API key kompletnie martwy.** `POST /settings/api-keys` (Settings → API, ścieżka pokazywana w UI i w README MCP) zapisuje do tabeli `ApiKey`, ale `PublicAuthMiddleware`/`getOrgByApiKey()` czyta wyłącznie stare pojedyncze pole `Organization.apiKey`. Każdy klucz wygenerowany oficjalną ścieżką onboardingu daje `401 Invalid API key` na każdym wywołaniu Public API i MCP. Znalezione niezależnie przez Deva i Rena. To jest droga onboardingowa dla dokładnie tych person (developer, automation engineer), które produkt ma teraz przyciągnąć.

**Login nie wymusza Origin tam, gdzie oczekiwano.** Dev przetestował `POST /auth/login` bez nagłówka `Origin` i z podrobionym `Origin: https://evil.com` — oba razy `200` i ustawiona ciasteczko sesji. CSRF origin-check (opisany w CLAUDE.md jako egzekwowany) najwyraźniej nie łapie tego konkretnego endpointu. Wymaga potwierdzenia/przejrzenia — może być zamierzone (login sam nie jest state-changing w sensie CSRF), ale warto zweryfikować że żaden faktycznie wrażliwy endpoint nie ma tej samej luki.

**Walidacja draftów blokuje na polach niezwiązanych z draftem.** `CreatePostDto`'s `ValidateIf` sprawdza `type` na poziomie pojedynczego posta w tablicy, nie na poziomie requestu — efekt: `settings` (np. `who_can_reply_post` dla X) są wymagane nawet dla `type:"draft"`, mimo że mają być pomijalne. Dev i Ren obaj stracili rundę na to. Pogłębione przez MCP tool który mówi agentowi wprost "settings: usually omit" — czyli własna dokumentacja narzędzia prowadzi prosto w ten błąd.

**MCP README niespójny z kodem.** Tabela narzędzi w README nie wymienia `postsider_request_approval` / `postsider_get_approval_status`, mimo że oba istnieją i działają.

**Swagger reklamuje martwą metodę auth.** `/docs` opisuje trzy sposoby autoryzacji Public API w tym `agt_` "agent token" — grep pokazuje że `agt_` nie jest nigdzie faktycznie sprawdzane, występuje tylko w komentarzu CSRF i w regexie maskującym sekrety w Sentry.

**README SDK-przykład niezgodny z realnym DTO.** `postList({ page, limit })` z README nie odpowiada faktycznemu `GetPostsDto` (`startDate`/`endDate` wymagane, brak paginacji).

**Brak webhooka dla zdarzeń approval.** Jedyny webhook wychodzący to `post.published`. Automatyzacja (Ren) musi pollować `GET .../approval` zamiast dostać push w momencie decyzji klienta — realna luka dla "zero-click" pipeline'u.

**Zarządzanie webhookami poza Public API.** `/webhooks` jest tylko sesja-cookie, nie `/public/v1` — headless pipeline nie może samodzielnie zarejestrować webhooka kluczem API, wymaga ręcznego kroku w dashboardzie.

**Drobne (nieblokujące):** brak API do skasowania rozpatrzonego rekordu `PostApproval` (zostaje sierota po skasowaniu posta — sam framework je toleruje, ale warto dodać cascade albo endpoint); evergreen ma cichy globalny switch w Settings który wyłącza wszystkie per-post recycle bez ostrzeżenia w UI przy włączaniu per-post; brak dashboardu/orientacji na pierwszym ekranie po loginie (prosto na pusty kalendarz).

## Co działa dobrze (potwierdzone live, nie tylko w kodzie)

- **Guest-review link** (core różnicujący feature) — zero logowania, zero brandingu PostSider, single-use wymuszone (drugi resolve tego samego tokenu = `400 invalid or expired`), dokładnie to czego potrzebuje agencja do wysyłki klientowi. Marta: "would trust sending this to a client."
- **Cały łańcuch approval przez czysty HTTP** (draft → request-approval kluczem API bez sesji → guest-link → resolve → poll status) potwierdzony przez Rena end-to-end jako w pełni automatyzowalny, bez żadnego kroku wymagającego przeglądarki.
- **Komunikaty błędów są konkretne i akcyjne** — poprawne kody HTTP, komunikaty per-pole, wystarczające żeby budować logikę obsługi błędów bez zgadywania (Dev, 4/4 przetestowane malformed requesty).
- **Composer** oceniony jako "more capable than expected" — multi-channel, per-channel overrides, Smart Slots, first-comment, UTM/hashtag helpers, drag-reorder mediów.
- **Smart Slots + "add to queue"** — Jules: realne "wybierz mi dobry czas" bez myślenia, jedno kliknięcie.
- **Mobile** — hamburger drawer poniżej 900px z prawdziwym backdrop, potwierdzone w kodzie.
- **CSV export z analytics** — realny mechanizm do miesięcznego raportu dla klienta/zarządu, nie tylko screenshot.

## Niejasność modelu biznesowego (nie bug, ale realne zderzenie)

Marta zauważyła sprzeczność: multi-org daje każdej nowej organizacji własny trial i własną subskrypcję (model per-klient billing, jak reseller) — ale flat pricing (np. $45/mies za 30 kanałów) sugeruje jedną płaską organizację na całą agencję. Te dwa modele ciągną w różne strony i nie jest jasne z UI, którego agencja ma użyć przy 15 klientach. Warto rozstrzygnąć i to zakomunikować (albo w onboardingu, albo w cenniku) zanim ruch trafi do prawdziwych agencji.

## Rekomendacja przed publikacją

Jeden blocker realny: **napraw self-serve API key przed publikacją** — to jest pierwszy krok, jaki zrobi każdy developer/automation-engineer trafiający na produkt, i teraz kończy się głuchym `401` bez żadnej wskazówki co poszło nie tak. Reszta to poprawki jakości (dokumentacja, webhook coverage, drobne UX) które można domykać po starcie.
