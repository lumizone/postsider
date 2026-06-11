# Requirements Document

_Język dokumentu: polski. Treść jest w języku polskim, jednak tytuły wymagań i nagłówki sekcji pozostają w języku angielskim zgodnie z wymogami formatu Kiro spec, a słowa kluczowe EARS (WHEN, WHILE, WHERE, IF, THEN, THE, SHALL) pozostają w języku angielskim zgodnie z normą EARS._

## Introduction

Repozytorium PostSider jest forkiem `postiz-app` przekształcanym w **most publikacyjny i komunikacyjny dla agentów AI** (zgodnie ze specem `postsider-rebrand-ai-agent-bridge`). Powierzchnie dla agentów (`MCP_Server`, `REST_API` pod `/public/v1`, `Agent_SDK`) są pierwszorzędnym interfejsem produktu, natomiast UI administracyjne (`Scheduler_UI` w terminologii rebrandu) jest komponentem drugorzędnym, służącym ludzkim operatorom do konfiguracji organizacji, autoryzacji konektorów, podglądu i zatwierdzania działań agentów oraz ręcznej publikacji.

W obecnym monorepo (`apps/backend`, `apps/orchestrator`, `apps/commands`, `apps/sdk`) **nie istnieje katalog `apps/frontend`** — ten dokument definiuje wymagania produktowe i jakościowe dla utworzenia go od zera (lub odtworzenia z forka). Aplikacja frontendowa MUSI komunikować się wyłącznie z istniejącym backendem NestJS przez kontrakt HTTP udostępniany pod prefiksem `/api` (publiczne kontrolery z `apps/backend/src/api/routes/*`) oraz, opcjonalnie, przez WebSocket na potrzeby realtime updates.

Ten dokument opisuje wyłącznie wymagania funkcjonalne, jakościowe i niefunkcjonalne. Decyzje implementacyjne (struktura katalogów, biblioteki UI, podejście do data fetching, strategia stylowania, struktura testów) zostaną doprecyzowane w fazie Design.

### Scope

Zakres obejmuje wyłącznie **dashboard aplikacyjny po zalogowaniu** plus minimalny zestaw stron pre-auth (logowanie, rejestracja, OAuth callback, reset hasła, strony błędów). Moduły zostały podzielone na dwie fazy:

- **MVP (Phase 1):** App Shell, Auth & Onboarding, Dashboard / Home, Calendar & Composer, Posts management, Connectors, Media library, Account Settings, Organization Settings, Notifications (preferences + center).
- **Phase 2:** Analytics, Agents & Tokens, Inbound feed, Admin / Enterprise (multi-org, audit log, monitor, approved apps, announcements admin), Agent activity visibility (markery w UI dla akcji `Agent_Token`, HITL approvals).

### Out of scope

Następujące obszary są **jawnie poza zakresem** tego speca i NIE MUSZĄ być pokryte żadnym wymaganiem:

- Billing, plany subskrypcji, płatności, integracja ze Stripe, faktury, portale rozliczeniowe.
- Limity wynikające z planu płatnego (np. `feature_gate` na podstawie subskrypcji).
- Strony marketingowe, landing page produktu, dokumentacja publiczna, blog.
- Backend: zmiany w kontrolerach NestJS, schemacie Prisma, orchestratorze. Frontend MUSI konsumować backend w jego obecnej formie (z wyłączeniem `billing.controller.ts` i `stripe.controller.ts`, które są poza zakresem).
- Implementacja powierzchni agenta (`MCP_Server`, `REST_API` `/public/v1`, `Agent_SDK`) — pokrywane przez spec `postsider-rebrand-ai-agent-bridge`. Frontend tylko wyświetla efekty działań agenta i pozwala nimi zarządzać.

## Glossary

Glosariusz wykorzystuje pojęcia zdefiniowane w specu `postsider-rebrand-ai-agent-bridge` (`PostSider_System`, `Connector`, `Connector_Catalog`, `Capability`, `Inbound_Source`, `Outbound_Channel`, `Agent_Token`, `Auth_Service`, `Audit_Log`, `Audit_Logger`, `HITL_Mode`, `MCP_Server`, `REST_API`, `Agent_SDK`, `Agent_Bridge`, `Webhook_Dispatcher`, `Observability_System`). Poniżej zdefiniowano wyłącznie terminy specyficzne dla frontendu.

- **Frontend_App**: Aplikacja kliencka uruchamiana w przeglądarce, dostarczana z workspace `apps/frontend`. Konsumuje backend NestJS przez HTTP `/api`. W terminologii rebrandu jest specjalizacją `Scheduler_UI`.
- **Admin_Panel**: Synonim `Frontend_App` używany w kontekście, w którym podkreślana jest rola UI jako narzędzia administracyjnego dla ludzi (w odróżnieniu od `Agent_Bridge`).
- **App_Shell**: Wspólny szkielet `Frontend_App` obejmujący nawigację, top-bar, switcher organizacji, menu użytkownika, breadcrumbs, system powiadomień toast i kontener treści. Renderowany dla każdej zalogowanej trasy.
- **Auth_Flow**: Zbiór ekranów i przejść stanu obsługujących logowanie, rejestrację, OAuth (Google, GitHub, Farcaster, Wallet), reset hasła i wybór organizacji po zalogowaniu.
- **Org_Switcher**: Komponent w `App_Shell` umożliwiający użytkownikowi przełączanie aktywnej `Organization` bez wylogowania.
- **Dashboard_Home**: Strona startowa po zalogowaniu, prezentująca przegląd aktywności (ostatnie publikacje, status konektorów, aktywne `Agent_Token`, niedawne wpisy w `Audit_Log`, aktualne `Announcement`).
- **Calendar_View**: Widok kalendarza prezentujący zaplanowane i opublikowane `Post` w trybach: miesiąc, tydzień, dzień. Wspiera drag-and-drop reschedulowanie.
- **Composer**: Edytor pojedynczego `Post` z wyborem `Outbound_Channel`, walidacją per-konektor, podglądem per platforma, wyborem mediów i czasem publikacji.
- **Post**: Encja reprezentująca treść do publikacji w jednym lub więcej `Outbound_Channel`, mająca status (`draft`, `scheduled`, `processing`, `published`, `failed`, `pending_approval`).
- **Posts_List**: Widok listy `Post` z filtrami (status, kanał, autor, data, źródło — człowiek lub `Agent_Token`).
- **Set**: Zapisany szablon konfiguracji `Composer` (zestaw kanałów + autopost), zgodnie z kontrolerem `sets.controller.ts`.
- **Autopost_Config**: Konfiguracja automatycznej publikacji, zgodnie z kontrolerem `autopost.controller.ts`.
- **Media_Library**: Widok zarządzania plikami mediów (upload, organizacja, podpisane URL-e przez `signature.controller.ts`, używanie w `Composer`).
- **Media_Asset**: Pojedynczy plik medialny (obraz, wideo, GIF) z metadanymi (rozmiar, typ MIME, wymiary, czas trwania).
- **Connectors_View**: Widok listy konektorów z `Connector_Catalog`, statusu autoryzacji, przycisków „Authorize / Reauthorize / Revoke" oraz informacji o deklarowanych `Capability`.
- **Analytics_View**: Widok metryk publikacyjnych w rozbiciu per `Connector`, per `Post`, per okres czasowy, z porównaniem okres-do-okresu i eksportem.
- **Agents_View**: Widok zarządzania `Agent_Token` — tworzenie, scope (organizacja, konektory, capability), TTL, rotacja, podgląd `Audit_Log` per token, włączanie `HITL_Mode` na poziomie organizacji.
- **Inbound_Feed_View**: Widok listy zdarzeń przychodzących z aktywnych `Inbound_Source` z możliwością inspekcji payloadu, statusu dostarczenia webhooka i ponowienia próby.
- **Account_Settings**: Sekcja ustawień użytkownika (profil, hasło, sesje, osobiste klucze API, język UI, motyw).
- **Org_Settings**: Sekcja ustawień organizacji (nazwa, logo, członkowie zespołu, role, zaproszenia).
- **Notification_Preferences**: Sekcja ustawień określająca kanały powiadomień (in-app, e-mail) per typ zdarzenia.
- **Notification_Center**: Komponent w `App_Shell` prezentujący in-app feed powiadomień (publikacje udane, nieudane, akcje agentów wymagające zatwierdzenia, zaproszenia, ogłoszenia).
- **Admin_View**: Widok dostępny tylko użytkownikom z rolą administratora globalnego (kontrolery `admin.controller.ts`, `enterprise.controller.ts`, `monitor.controller.ts`, `approved-apps.controller.ts`, `announcements.controller.ts`).
- **HITL_Approval_Queue**: Komponent prezentujący `Post` w stanie `pending_approval` utworzone przez `Agent_Token` przy włączonym `HITL_Mode`, z akcjami „Approve" i „Reject".
- **Backend_API**: Zestaw kontrolerów NestJS pod prefiksem `/api` w `apps/backend`, konsumowany przez `Frontend_App`. NIE obejmuje `billing.controller.ts` ani `stripe.controller.ts`.
- **Theme**: Motyw kolorystyczny `Frontend_App` z dwiema wartościami: `light` i `dark`.
- **Locale**: Kod języka UI; obsługiwane wartości w v1: `pl`, `en`. Domyślna wartość: `pl`.
- **A11y_Standard**: WCAG 2.1 Level AA jako docelowa norma dostępności `Frontend_App`.

## Requirements

### Requirement 1: [F1] Frontend application workspace

**User Story:** Jako maintainer monorepo, chcę aby aplikacja frontendowa istniała jako osobny workspace `apps/frontend`, aby była budowana, testowana i wdrażana niezależnie od backendu.

#### Acceptance Criteria

1. THE PostSider_System SHALL provide a `Frontend_App` workspace at `apps/frontend` registered in the root `pnpm-workspace.yaml`.
2. THE Frontend_App SHALL declare a `package.json` whose `name` field uses the `Canonical_Identifier` namespace defined in the rebrand spec.
3. WHEN `pnpm install` is executed at the repository root, THE Build_System SHALL install `Frontend_App` dependencies without conflict with `apps/backend`, `apps/orchestrator`, `apps/commands` or `apps/sdk`.
4. WHEN `pnpm --filter ./apps/frontend run build` is executed, THE Build_System SHALL produce a deployable artifact in the directory declared by the framework configuration.
5. WHEN `pnpm --filter ./apps/frontend run lint` and `pnpm --filter ./apps/frontend run test` are executed, THE Build_System SHALL run the linter and unit tests of `Frontend_App` without depending on the backend being running.

### Requirement 2: [F2] Frontend technology stack

**User Story:** Jako developer dołączający do projektu, chcę aby stack frontendowy był jednoznacznie zadeklarowany i zgodny z aktualnymi zależnościami repozytorium, abym nie tracił czasu na rozstrzyganie sprzeczności w dokumentacji.

#### Acceptance Criteria

1. THE Frontend_App SHALL be implemented in TypeScript using the Next.js 16 framework with the App Router and React Server Components, consistent with the framework declared by the rebrand spec Requirement 5.2.
2. THE Frontend_App SHALL target Node.js runtime version `>=22.12.0 <23.0.0`, consistent with the root `package.json` `engines` field.
3. THE Documentation SHALL describe the frontend stack consistently across `README.md`, `CLAUDE.md`, `.github/copilot-instructions.md` and `apps/frontend/README.md`.
4. WHERE the design phase selects supporting libraries (UI component library, styling system, data-fetching client, form library, i18n library, test runner), THE Design SHALL document each selection together with the rationale and the integration approach.

### Requirement 3: [F3] Backend integration contract

**User Story:** Jako developer frontendu, chcę aby cała komunikacja z backendem przechodziła przez jeden, dobrze zdefiniowany klient HTTP, abym nie powielał logiki uwierzytelniania, błędów i serializacji.

#### Acceptance Criteria

1. THE Frontend_App SHALL communicate with the `Backend_API` exclusively through HTTP requests rooted at the prefix `/api` configured by the environment variable defined in the design phase.
2. THE Frontend_App SHALL implement a single shared HTTP client that attaches authentication credentials, sets the active organization header and applies a uniform error-mapping policy.
3. THE Frontend_App SHALL NOT call any endpoint of `billing.controller.ts` or `stripe.controller.ts`, since those controllers are out of scope for this spec.
4. WHEN the `Backend_API` returns an HTTP 401 response, THE Frontend_App SHALL clear the local authentication state and redirect the user to the login screen.
5. WHEN the `Backend_API` returns an HTTP 403 response, THE Frontend_App SHALL display a permission-denied notice describing the missing capability and SHALL NOT log out the user.
6. WHEN the `Backend_API` returns an HTTP 5xx response, THE Frontend_App SHALL display a retryable error notice and SHALL emit a structured client-side log entry to `Observability_System`.
7. IF the `Backend_API` returns a payload validation error structured as a `posts.validation.exception`, THEN THE Composer SHALL surface the per-channel validation messages next to the affected channel.

### Requirement 4: [F4] App shell and navigation

**User Story:** Jako zalogowany użytkownik, chcę aby aplikacja miała spójny layout z wyraźną nawigacją między modułami, abym mógł szybko przełączać się między kalendarzem, listą postów, mediami i ustawieniami.

#### Acceptance Criteria

1. THE App_Shell SHALL render for every route that requires authentication and SHALL contain a navigation sidebar, a top bar with `Org_Switcher`, a `Notification_Center` trigger, a user menu and a content slot for the current route.
2. THE App_Shell SHALL expose top-level navigation entries for: `Dashboard_Home`, `Calendar_View`, `Posts_List`, `Connectors_View`, `Media_Library`, `Notification_Preferences` (under Settings), `Account_Settings`, `Org_Settings`.
3. WHERE the active user has the role required to view the Phase 2 modules, THE App_Shell SHALL expose additional navigation entries for `Analytics_View`, `Agents_View`, `Inbound_Feed_View` and `Admin_View`.
4. WHEN the user resizes the viewport below the breakpoint defined for mobile in the design phase, THE App_Shell SHALL collapse the sidebar into a drawer that opens on user interaction.
5. WHEN the user navigates between modules, THE App_Shell SHALL preserve the `Org_Switcher` selection and SHALL NOT trigger a full page reload.
6. THE App_Shell SHALL display the `Canonical_Identifier` product name and logo, and SHALL NOT display any `Legacy_Identifier` defined in the rebrand spec.

### Requirement 5: [F5] Authentication and onboarding

**User Story:** Jako nowy użytkownik, chcę móc założyć konto, zalogować się i wybrać organizację, aby uzyskać dostęp do panelu i zacząć korzystać z funkcji.

#### Acceptance Criteria

1. THE Auth_Flow SHALL provide screens for: sign-in by e-mail and password, sign-up by e-mail and password, password reset request, password reset confirmation, OAuth sign-in for Google, OAuth sign-in for GitHub, sign-in by Farcaster and sign-in by Wallet.
2. WHEN the user submits valid credentials, THE Auth_Flow SHALL persist the authentication state through the mechanism defined in the design phase and SHALL redirect the user to `Dashboard_Home`.
3. WHEN the user belongs to more than one organization, THE Auth_Flow SHALL present an organization-selection screen after sign-in and SHALL set the active organization based on the user's selection.
4. WHEN the user accepts an invitation, THE Auth_Flow SHALL associate the invited account with the inviting organization and SHALL grant the role specified in the invitation.
5. IF the user submits invalid credentials, THEN THE Auth_Flow SHALL display a generic credentials-error message and SHALL NOT disclose whether the e-mail address is registered.
6. IF an OAuth provider returns an error to the redirect callback, THEN THE Auth_Flow SHALL display a provider-specific error message and SHALL offer a retry action.
7. WHEN the user signs out, THE Frontend_App SHALL clear the local authentication state, revoke the session through the `Backend_API` and redirect the user to the sign-in screen.

### Requirement 6: [F6] Dashboard home

**User Story:** Jako operator, chcę po zalogowaniu zobaczyć przegląd aktywności mojej organizacji, abym szybko ocenił czy coś wymaga mojej uwagi.

#### Acceptance Criteria

1. THE Dashboard_Home SHALL display the count and status summary of the user's `Post` items grouped by status (`draft`, `scheduled`, `processing`, `published`, `failed`).
2. THE Dashboard_Home SHALL display a list of the most recent publications with publication time, target `Outbound_Channel`, status and a link to the underlying `Post`.
3. THE Dashboard_Home SHALL display the connectivity status of every authorized `Connector` for the active organization and SHALL highlight any connector marked as `unauthorized`.
4. THE Dashboard_Home SHALL display the most recent `Announcement` entries returned by `announcements.controller.ts`.
5. WHERE the active organization has at least one `Agent_Token` in any state (active, expired or revoked), THE Dashboard_Home SHALL display a summary card with the count of currently active tokens (which MAY be zero) and the count of agent operations recorded in the last 24 hours.
6. WHEN the user clicks any item on `Dashboard_Home`, THE App_Shell SHALL navigate to the corresponding detailed view.

### Requirement 7: [F7] Calendar view

**User Story:** Jako planista treści, chcę widzieć moje zaplanowane i opublikowane posty na kalendarzu, abym mógł zarządzać harmonogramem wizualnie.

#### Acceptance Criteria

1. THE Calendar_View SHALL provide three view modes: `month`, `week`, `day`, and SHALL persist the user's last selected mode for the duration of the session.
2. THE Calendar_View SHALL render every `Post` whose status is `scheduled`, `processing`, `published`, `failed` or `pending_approval` within the visible date range of the active organization.
3. WHEN the user drags a `Post` to a different date or time slot, THE Calendar_View SHALL reschedule the `Post` through the `Backend_API` and SHALL update the optimistic position in the UI before the response arrives.
4. IF the rescheduling request fails, THEN THE Calendar_View SHALL revert the `Post` to its previous position and SHALL display an error notice.
5. WHEN the user clicks an empty time slot, THE Calendar_View SHALL open the `Composer` pre-filled with the selected date and time.
6. WHEN the user clicks an existing `Post`, THE Calendar_View SHALL open the `Composer` in edit mode for that `Post`.
7. THE Calendar_View SHALL render visual markers distinguishing each `Outbound_Channel` and each `Post` status by colour and icon defined in the design phase.

### Requirement 8: [F8] Post composer

**User Story:** Jako autor treści, chcę móc tworzyć posty z wieloma kanałami, mediami i czasem publikacji, abym jedną akcją mógł opublikować treść w kilku miejscach.

#### Acceptance Criteria

1. THE Composer SHALL allow the user to select one or more authorized `Outbound_Channel` for the `Post`.
2. THE Composer SHALL provide a per-channel content editor that supports plain text and channel-specific formatting hints, plus shared media attachments from `Media_Library`.
3. THE Composer SHALL display a per-channel preview rendered to approximate the appearance of the `Post` on the corresponding `Connector`.
4. THE Composer SHALL validate per-channel constraints (text length, attachment count, media size, media type) using rules returned by the `Backend_API` and SHALL surface validation errors before submission.
5. THE Composer SHALL allow the user to save the `Post` as a `draft`, schedule it for a future timestamp, or publish immediately.
6. THE Composer SHALL allow the user to apply a saved `Set` to pre-fill the channel selection and `Autopost_Config`.
7. WHEN the user submits the `Post`, THE Composer SHALL submit the request to the `Backend_API` and SHALL display the resulting `Post` identifier on success.
8. IF the `Backend_API` returns a per-channel validation error, THEN THE Composer SHALL highlight every affected channel with the corresponding error message.
9. WHILE a submission request is in flight, THE Composer SHALL disable the submit action and display a progress indicator.

### Requirement 9: [F9] Posts list

**User Story:** Jako edytor treści, chcę móc przeglądać i filtrować wszystkie posty mojej organizacji, abym mógł znaleźć konkretny wpis bez kalendarza.

#### Acceptance Criteria

1. THE Posts_List SHALL display every `Post` of the active organization with columns for content excerpt, target `Outbound_Channel`, status, scheduled or published timestamp and creator.
2. THE Posts_List SHALL provide filters for status, `Outbound_Channel`, creator, date range and creation source (human user or `Agent_Token`).
3. THE Posts_List SHALL provide pagination using the mechanism defined in the design phase, with a configurable page size.
4. WHEN the user clicks a `Post` row, THE App_Shell SHALL open the `Composer` in edit mode for that `Post`.
5. WHERE a `Post` has the status `failed`, THE Posts_List SHALL display the failure reason returned by the `Backend_API` and SHALL provide a retry action.
6. WHERE a `Post` has the status `pending_approval`, THE Posts_List SHALL display an indicator that the `Post` originates from an `Agent_Token` and is awaiting human approval.

### Requirement 10: [F10] Connectors view

**User Story:** Jako administrator organizacji, chcę zarządzać autoryzacjami konektorów, abym kontrolował, do jakich platform aplikacja ma dostęp.

#### Acceptance Criteria

1. THE Connectors_View SHALL display every entry of `Connector_Catalog` with its label, icon, declared `Capability` flags and authorization status for the active organization.
2. THE Connectors_View SHALL provide an action to authorize each `Connector` that delegates to the OAuth flow served by `oauth.controller.ts` or `integrations.controller.ts`.
3. THE Connectors_View SHALL provide an action to refresh credentials for an already authorized `Connector`.
4. THE Connectors_View SHALL provide an action to revoke an authorized `Connector` after a confirmation dialog.
5. WHEN a `Connector` is authorized, THE Connectors_View SHALL update the connector's status to `authorized` in place using the realtime mechanism defined in the design phase, and SHALL NOT trigger a full page reload.
6. IF a `Connector` provider revokes its credentials externally, THEN THE Connectors_View SHALL display the connector with status `unauthorized` and SHALL offer a re-authorize action.
7. THE Connectors_View SHALL display, for each `Connector`, the declared values of `PUBLISH`, `SOURCE`, `ANALYTICS` and `SCHEDULE` capabilities.

### Requirement 11: [F11] Media library

**User Story:** Jako twórca treści, chcę mieć centralne miejsce na pliki medialne, abym mógł je wielokrotnie wykorzystywać w różnych postach.

#### Acceptance Criteria

1. THE Media_Library SHALL display every `Media_Asset` of the active organization with thumbnail, filename, type, size and upload date.
2. THE Media_Library SHALL allow the user to upload a new `Media_Asset` through `media.controller.ts`, with a progress indicator for each upload.
3. THE Media_Library SHALL request a signed upload URL through `signature.controller.ts` when the file size exceeds the threshold defined in the design phase, and SHALL upload directly to the storage service for files exceeding that threshold.
4. THE Media_Library SHALL allow the user to delete a `Media_Asset` after a confirmation dialog.
5. THE Media_Library SHALL allow the user to insert a `Media_Asset` directly into the active `Composer` instance.
6. IF an upload fails, THEN THE Media_Library SHALL display the failure reason and SHALL offer a retry action without re-selecting the file.
7. THE Media_Library SHALL provide search by filename and filter by media type (image, video, audio, document).

### Requirement 12: [F12] Account settings

**User Story:** Jako użytkownik, chcę zarządzać swoim profilem, hasłem i sesjami, abym mógł utrzymać bezpieczeństwo własnego konta.

#### Acceptance Criteria

1. THE Account_Settings SHALL allow the user to view and update display name, e-mail address and avatar.
2. THE Account_Settings SHALL allow the user to change password by providing the current password and a new password.
3. THE Account_Settings SHALL allow the user to view active sessions and revoke any session other than the current one.
4. THE Account_Settings SHALL allow the user to manage personal API keys by listing existing keys with creation date and last-used date and by revoking individual keys.
5. THE Account_Settings SHALL allow the user to select the active `Locale` from the supported set (`pl`, `en`) and SHALL persist the selection across sessions.
6. THE Account_Settings SHALL allow the user to select the active `Theme` from the supported set (`light`, `dark`) and SHALL persist the selection across sessions.
7. IF the user submits an invalid current password during password change, THEN THE Account_Settings SHALL display a credentials-error message and SHALL guarantee that the user's password remains unchanged regardless of any other request state, and THE Account_Settings SHALL allow the user to retry the password change regardless of how many sessions are currently active.

### Requirement 13: [F13] Organization settings

**User Story:** Jako administrator organizacji, chcę zarządzać danymi organizacji i jej członkami, abym mógł kontrolować skład zespołu.

#### Acceptance Criteria

1. THE Org_Settings SHALL allow an administrator to view and update organization name, logo and timezone.
2. THE Org_Settings SHALL display every member of the organization with role, status (`active`, `invited`, `disabled`) and the timestamp of last activity.
3. THE Org_Settings SHALL allow an administrator to invite a new member by e-mail address with a selectable role.
4. THE Org_Settings SHALL allow an administrator to change the role of an existing member.
5. THE Org_Settings SHALL allow an administrator to remove a member after a confirmation dialog.
6. THE Org_Settings SHALL display the role-permissions matrix for the active organization.
7. IF a non-administrator user opens `Org_Settings`, THEN THE Frontend_App SHALL display a read-only version of the organization details and SHALL hide every modifying action.

### Requirement 14: [F14] Notification preferences and notification center

**User Story:** Jako użytkownik, chcę kontrolować, jakie powiadomienia otrzymuję i gdzie, abym nie był zalewany szumem.

#### Acceptance Criteria

1. THE Notification_Preferences SHALL allow the user to enable or disable the `in-app` and `e-mail` channels independently for each notification type returned by `notifications.controller.ts`.
2. THE Notification_Center SHALL display every in-app notification of the active user grouped by date with read or unread state.
3. WHEN a new in-app notification is delivered while the user is logged in, THE Notification_Center SHALL increment the unread badge count from its current value (including the transition from zero to one) without requiring a page reload, using the realtime mechanism defined in the design phase.
4. THE Notification_Center SHALL allow the user to mark an individual notification as read, mark all notifications as read and dismiss a notification.
5. WHEN the user clicks a notification that references a `Post`, an `Announcement` or an invitation, THE Notification_Center SHALL navigate to the corresponding view.

### Requirement 15: [F15] Internationalization

**User Story:** Jako użytkownik mówiący po polsku lub po angielsku, chcę aby UI był dostępny w moim języku, abym mógł komfortowo używać aplikacji.

#### Acceptance Criteria

1. THE Frontend_App SHALL support the `Locale` values `pl` and `en` in v1, with `pl` as the default `Locale` for unauthenticated visitors.
2. THE Frontend_App SHALL externalize every user-visible string into translation files keyed by feature module, and SHALL NOT hardcode user-visible strings in source code.
3. WHEN the user's `Locale` preference is set in `Account_Settings`, THE Frontend_App SHALL render every user-visible string using the selected `Locale` and SHALL ignore the browser's `Accept-Language` header for authenticated users.
4. WHERE a translation key is missing for the active `Locale`, THE Frontend_App SHALL fall back to the `pl` translation and SHALL emit a structured client-side log entry identifying the missing key.
5. THE Frontend_App SHALL be architected so that adding a new `Locale` requires only adding a new translation file and registering it in the i18n configuration.

### Requirement 16: [F16] Theming

**User Story:** Jako użytkownik, chcę móc wybrać tryb jasny lub ciemny, aby UI był wygodny w moich warunkach pracy.

#### Acceptance Criteria

1. THE Frontend_App SHALL support the `Theme` values `light` and `dark`.
2. WHEN the user has not explicitly selected a `Theme`, THE Frontend_App SHALL apply the `Theme` matching the operating system's `prefers-color-scheme` setting.
3. WHEN the user selects a `Theme` in `Account_Settings`, THE Frontend_App SHALL apply the selected `Theme` immediately and SHALL persist the selection across sessions.
4. IF persisting the selected `Theme` to the `Backend_API` or to client-side storage fails, THEN THE Frontend_App SHALL continue rendering the user's selected `Theme` for the duration of the current session and SHALL emit a structured client-side log entry describing the persistence failure.
5. THE Frontend_App SHALL apply the active `Theme` consistently across every module, every component and every interactive state.

### Requirement 17: [F17] Responsiveness

**User Story:** Jako użytkownik mobilny, chcę aby aplikacja była użyteczna na ekranie telefonu, abym mógł korzystać z niej w drodze.

#### Acceptance Criteria

1. THE Frontend_App SHALL render correctly on viewport widths between 360 pixels and 2560 pixels without horizontal scrolling on the document level.
2. THE App_Shell SHALL adapt the navigation between desktop sidebar and mobile drawer using the breakpoints defined in the design phase.
3. THE Calendar_View SHALL provide a usable mobile presentation, which MAY collapse the `month` mode into the `day` mode on viewports narrower than the mobile breakpoint.
4. THE Composer SHALL remain usable for creating a `Post` on the smallest supported viewport, with all primary actions reachable without horizontal scrolling.

### Requirement 18: [F18] Accessibility

**User Story:** Jako użytkownik korzystający z technologii asystujących, chcę aby aplikacja była dostępna, abym mógł obsłużyć ją klawiaturą i czytnikiem ekranu.

#### Acceptance Criteria

1. THE Frontend_App SHALL conform to `A11y_Standard` (WCAG 2.1 Level AA) for every shipped screen.
2. THE Frontend_App SHALL ensure that every interactive control is reachable and operable using keyboard alone, with a visible focus indicator displayed only on the currently focused control and absent from unfocused controls.
3. THE Frontend_App SHALL associate every form input with a programmatically resolvable label and SHALL announce validation errors to assistive technologies.
4. THE Frontend_App SHALL provide text alternatives for every non-decorative image, icon and media asset rendered in `Media_Library` and `Composer` previews.
5. WHEN the user activates a modal dialog, THE Frontend_App SHALL trap keyboard focus within the dialog and SHALL restore focus to the triggering control on dialog close.

### Requirement 19: [F19] Client-side observability

**User Story:** Jako inżynier on-call, chcę widzieć błędy klienckie i metryki użycia, abym mógł diagnozować incydenty bez prośby do użytkowników o screenshoty.

#### Acceptance Criteria

1. WHEN an unhandled exception occurs in the `Frontend_App`, THE Frontend_App SHALL emit a Sentry event to the `Observability_System` containing the redacted user identifier, the active organization identifier, the route and the exception stack.
2. THE Frontend_App SHALL emit a structured client-side log entry for every failed `Backend_API` request containing the endpoint, the HTTP status, the correlation identifier returned by the backend and the redacted error body.
3. THE Frontend_App SHALL NOT log any password, `Agent_Token` value, third-party provider credential or `Media_Asset` content.
4. WHERE the user has not consented to telemetry through `Account_Settings`, THE Frontend_App SHALL emit only error events and SHALL NOT emit usage analytics events from any application module, and THE Frontend_App SHALL configure third-party libraries integrated through the `Frontend_App` so that those libraries also do not emit usage analytics events.

### Requirement 20: [F20] Performance

**User Story:** Jako użytkownik, chcę aby kluczowe ekrany ładowały się szybko, abym nie czekał na panel.

#### Acceptance Criteria

1. WHEN the user opens `Dashboard_Home` after authentication, THE Frontend_App SHALL render the first meaningful content within 2 seconds at the 95th percentile on a desktop reference device on a 50 Mbps connection.
2. WHEN the user navigates between modules within `App_Shell`, THE Frontend_App SHALL render the new route within 500 milliseconds at the 95th percentile, excluding network time for the first request to the corresponding `Backend_API` endpoint.
3. WHEN the user opens `Calendar_View` for a date range containing up to 200 `Post` items, THE Calendar_View SHALL render the calendar grid within 1 second at the 95th percentile.
4. WHEN the user uploads a `Media_Asset` smaller than 10 megabytes through `Media_Library`, THE Media_Library SHALL display upload completion within 5 seconds at the 95th percentile on a 50 Mbps upload connection.

### Requirement 21: [F21] Security

**User Story:** Jako specjalista ds. bezpieczeństwa, chcę aby frontend nie wprowadzał regresji bezpieczeństwa względem backendu, abym nie musiał audytować każdego deploya pod kątem podstawowych błędów.

#### Acceptance Criteria

1. THE Frontend_App SHALL NOT persist any password, `Agent_Token` value or third-party provider credential in `localStorage`, `sessionStorage` or any non-`HttpOnly` cookie.
2. THE Frontend_App SHALL set a Content Security Policy header through the framework configuration that disallows inline scripts except those required by the framework's runtime.
3. WHEN the `Frontend_App` renders user-supplied content from any source, including post body, member display name, organization name and connector-supplied content, THE Frontend_App SHALL sanitize the content against cross-site scripting using the library defined in the design phase, regardless of the apparent simplicity of the content.
4. THE Frontend_App SHALL include a CSRF protection mechanism for every state-changing request to the `Backend_API`, consistent with the mechanism used by `auth.controller.ts`.
5. WHEN the user signs out, THE Frontend_App SHALL clear every cached `Backend_API` response from in-memory state and from any persistent client-side cache.

### Requirement 22: [F22] Testing

**User Story:** Jako maintainer, chcę aby zmiany we frontend były pokryte testami, abyśmy mogli refaktorować bez ryzyka regresji.

#### Acceptance Criteria

1. THE Frontend_App SHALL include unit tests for every shared utility, every reducer or store slice and every domain-specific hook, irrespective of whether equivalent code paths are exercised by component or end-to-end tests.
2. THE Frontend_App SHALL include component tests for every screen listed in Requirements 6 through 14 covering the success path and at least one error path per screen.
3. THE Frontend_App SHALL include at least one end-to-end test covering the flow `sign-in → open Dashboard_Home → create a Post in Composer → see the Post on Calendar_View`.
4. WHEN `pnpm --filter ./apps/frontend run test` is executed, THE Build_System SHALL execute every test in the unit and component test suites in non-watch mode and SHALL exit with a non-zero status if and only if at least one test fails or the test command did not execute the suites.
5. WHEN a pull request is opened, THE Verification_Suite SHALL run the unit, component and end-to-end test suites of `Frontend_App` and SHALL fail the pull request if any suite fails.

### Requirement 23: [F23-Phase2] Analytics view

**User Story:** Jako menedżer treści, chcę widzieć metryki publikacji w rozbiciu na kanały i okresy, abym mógł ocenić skuteczność strategii.

_Priority: Phase 2._

#### Acceptance Criteria

1. THE Analytics_View SHALL display aggregate metrics returned by `analytics.controller.ts` for the active organization grouped by `Connector` and by date range.
2. THE Analytics_View SHALL allow the user to compare a selected date range against the immediately preceding range of equal length.
3. THE Analytics_View SHALL display per-`Post` metrics for any `Post` of the active organization whose status is `published` and whose `Connector` declares the `ANALYTICS` capability.
4. THE Analytics_View SHALL allow the user to export the currently displayed metrics as a CSV file.
5. IF a `Connector` does not declare the `ANALYTICS` capability, THEN THE Analytics_View SHALL omit that connector from the connector breakdown and SHALL annotate the omission in the UI.

### Requirement 24: [F24-Phase2] Agents and tokens management

**User Story:** Jako administrator organizacji, chcę zarządzać tokenami agentów AI, abym kontrolował, co i w jakim zakresie agenci mogą robić.

_Priority: Phase 2._

#### Acceptance Criteria

1. THE Agents_View SHALL display every `Agent_Token` of the active organization with label, allowed `Connector` identifiers, allowed `Capability` values, expiration timestamp and last-used timestamp.
2. THE Agents_View SHALL allow an administrator to create a new `Agent_Token` with a label, scoped allowed `Connector` set, scoped allowed `Capability` set, an optional expiration timestamp and configurable rate-limit values consistent with `Rate_Limiter`.
3. WHEN an administrator creates a new `Agent_Token`, THE Agents_View SHALL display the token plaintext exactly once and SHALL warn the user that the value cannot be retrieved later.
4. THE Agents_View SHALL allow an administrator to rotate an `Agent_Token` by issuing a new value and revoking the old value after a configurable grace period.
5. THE Agents_View SHALL allow an administrator to revoke an `Agent_Token` immediately after a confirmation dialog.
6. THE Agents_View SHALL display the `Audit_Log` entries for every operation performed by a selected `Agent_Token`, with filtering by date range, operation name and result status.
7. THE Agents_View SHALL allow an administrator to enable or disable `HITL_Mode` for the active organization.
8. WHEN `HITL_Mode` is enabled for the active organization, THE Agents_View SHALL surface a banner on `Dashboard_Home` describing the consequence on agent publications.

### Requirement 25: [F25-Phase2] Inbound feed view

**User Story:** Jako operator, chcę widzieć zdarzenia napływające z konektorów źródłowych, abym mógł zweryfikować czy webhooki działają i czy nic się nie gubi.

_Priority: Phase 2._

#### Acceptance Criteria

1. THE Inbound_Feed_View SHALL display every event produced by an `Inbound_Source` of the active organization, sorted by event timestamp, with source identifier, event type and delivery status.
2. THE Inbound_Feed_View SHALL allow the user to inspect the raw payload of any event in a read-only viewer.
3. THE Inbound_Feed_View SHALL allow the user to filter by `Inbound_Source`, by event type and by delivery status.
4. WHERE an event has the delivery status `failed`, THE Inbound_Feed_View SHALL display the failure reason and SHALL provide a retry action that delegates to `Webhook_Dispatcher` through the `Backend_API`.
5. THE Inbound_Feed_View SHALL display delivery attempt history for the selected event, including timestamp, HTTP status and response excerpt.

### Requirement 26: [F26-Phase2] Admin and enterprise view

**User Story:** Jako administrator globalny, chcę mieć dostęp do narzędzi multi-org, audytu i monitoringu, abym mógł zarządzać instancją produktu.

_Priority: Phase 2._

#### Acceptance Criteria

1. THE Admin_View SHALL be reachable only by users whose role grants administrative access to `admin.controller.ts`, `enterprise.controller.ts`, `monitor.controller.ts`, `approved-apps.controller.ts` or `announcements.controller.ts`.
2. THE Admin_View SHALL provide a multi-organization listing with health indicators per organization.
3. THE Admin_View SHALL display the cross-organization `Audit_Log` filterable by organization, by user, by `Agent_Token`, by operation name, by result status and by time range.
4. THE Admin_View SHALL display the operational monitor data returned by `monitor.controller.ts`.
5. THE Admin_View SHALL allow a global administrator to manage approved applications served by `approved-apps.controller.ts`, including listing, approving and revoking entries.
6. THE Admin_View SHALL allow a global administrator to create, update, publish and retire `Announcement` entries served by `announcements.controller.ts`.
7. IF a non-administrator user attempts to navigate to `Admin_View`, THEN THE App_Shell SHALL respond as defined in Requirement 3.5 (HTTP 403 handling) and SHALL NOT render administrative controls.

### Requirement 27: [F27-Phase2] Agent activity visibility

**User Story:** Jako operator, chcę aby UI wyraźnie odróżniało działania ludzi od działań agentów AI, abym mógł nadzorować autonomię agentów i interweniować zanim coś zostanie opublikowane.

_Priority: Phase 2. Realizes Requirement 17.3 of the rebrand spec at the UI layer._

#### Acceptance Criteria

1. THE Calendar_View SHALL display a marker on every `Post` created by an `Agent_Token` that identifies the originating token by label.
2. THE Posts_List SHALL include a column or badge identifying every `Post` whose creation source is an `Agent_Token`, exposing the token label on hover or focus.
3. THE Notification_Center SHALL emit an in-app notification when an `Agent_Token` of the active organization creates a new `Post`, schedules a `Post` or fails to publish a `Post`.
4. WHERE the active organization has `HITL_Mode` enabled, THE Frontend_App SHALL provide a `HITL_Approval_Queue` view listing every `Post` with status `pending_approval` and SHALL allow an administrator to approve or reject each `Post`, and WHERE `HITL_Mode` is disabled for the active organization, THE Frontend_App SHALL NOT expose the approve and reject actions in `HITL_Approval_Queue`.
5. WHEN an administrator approves a `Post` in `HITL_Approval_Queue`, THE Frontend_App SHALL submit the approval to the `Backend_API` and SHALL transition the `Post` to status `scheduled` or `processing` according to the `Post`'s scheduled timestamp, and THE Frontend_App SHALL NOT transition any `pending_approval` `Post` to a publishing status without an explicit administrator approval, regardless of whether the scheduled timestamp lies in the past.
6. WHEN an administrator rejects a `Post` in `HITL_Approval_Queue`, THE Frontend_App SHALL submit the rejection to the `Backend_API` together with an optional reason and SHALL transition the `Post` to a non-publishing terminal state.
7. THE Agents_View, the `Audit_Log` panels in `Admin_View` and the per-token audit panel SHALL be reachable from any agent activity marker rendered by `Calendar_View`, `Posts_List` or `Notification_Center`.
