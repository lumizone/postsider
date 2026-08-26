# PostSider — Przewodnik podłączania kanałów (Integrations Setup Guide)

Ten dokument opisuje **co użytkownik końcowy musi przygotować** aby podłączyć każdy z kanałów social media do PostSider. Nie opisujemy tutaj flow OAuth (to jest zautomatyzowane) — skupiamy się na tym, co trzeba ustawić w `.env` i co trzeba zrobić na stronie danej platformy.

---

## Wymagania ogólne (infrastruktura)

Przed podłączeniem jakiegokolwiek kanału:

| Zmienna `.env` | Opis |
|---|---|
| `FRONTEND_URL` | Publiczny URL frontend (np. `https://app.yourdomain.com`) — używany do redirect URI |
| `BACKEND_URL` | Publiczny URL backendu |
| `CLOUDFLARE_*` | R2 bucket do przechowywania awatarów i mediów (lub `STORAGE_PROVIDER=local`) |

**Redirect URI** dla OAuth zawsze ma format:
```
${FRONTEND_URL}/integrations/social/{identyfikator-providera}
```

---

## 1. X (Twitter)

| Zmienna `.env` | Wartość |
|---|---|
| `X_API_KEY` | API Key (Consumer Key) |
| `X_API_SECRET` | API Secret (Consumer Secret) |
| `X_URL` | (opcjonalnie) custom URL |

### Jak uzyskać:
1. Idź na [developer.x.com](https://developer.x.com)
2. Utwórz projekt + aplikację z uprawnieniami **OAuth 1.0a** (Read and Write)
3. W ustawieniach aplikacji włącz "User authentication" z callback URL:
   - `${FRONTEND_URL}/integrations/social/x`
4. Skopiuj API Key i API Secret

### Uwagi:
- X używa OAuth 1.0a (nie 2.0)
- Limit: 300 postów / 3 godziny
- Max 4 zdjęcia LUB 1 video na post
- Opcjonalnie: `STRIP_LINKS_FROM_X_POSTS=true` aby usuwać linki z postów

---

## 2. LinkedIn (profil osobisty)

| Zmienna `.env` | Wartość |
|---|---|
| `LINKEDIN_CLIENT_ID` | Client ID |
| `LINKEDIN_CLIENT_SECRET` | Client Secret |

### Jak uzyskać:
1. Idź na [linkedin.com/developers](https://www.linkedin.com/developers/)
2. Utwórz aplikację
3. W zakładce "Auth" dodaj redirect URL:
   - `${FRONTEND_URL}/integrations/social/linkedin`
4. W "Products" dodaj:
   - **Share on LinkedIn**
   - **Sign In with LinkedIn using OpenID Connect**
   - **Community Management API** (opcjonalnie dla stron)

### Wymagane scopes:
`openid`, `profile`, `email`, `w_member_social`

### Uwagi:
- Ten sam Client ID/Secret obsługuje też LinkedIn Page
- Max 1 video LUB carousel (min 2 zdjęcia) na post

---

## 3. LinkedIn (strona firmowa)

Używa tych samych credentials co LinkedIn profil (`LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`).

Dodatkowy redirect URL:
- `${FRONTEND_URL}/integrations/social/linkedin-page`

### Dodatkowy scope:
`w_organization_social`, `r_organization_social`

---

## 4. Facebook (Page)

| Zmienna `.env` | Wartość |
|---|---|
| `FACEBOOK_APP_ID` | App ID |
| `FACEBOOK_APP_SECRET` | App Secret |

### Jak uzyskać:
1. Idź na [developers.facebook.com](https://developers.facebook.com/)
2. Utwórz aplikację typu "Business"
3. Dodaj produkt "Facebook Login for Business"
4. W Settings → Valid OAuth Redirect URIs:
   - `${FRONTEND_URL}/integrations/social/facebook`
5. W App Review przyznaj uprawnienia (live mode)

### Wymagane scopes:
`pages_show_list`, `business_management`, `pages_manage_posts`, `pages_read_engagement`, `pages_manage_engagement`

### Opcjonalne scopes (tylko w URL-u autoryzacji):
`pages_video_upload` — wymagane przez `POST /{page_id}/videos`, czyli publikacje
wideo. Meta przyznaje je dopiero z Advanced Access, dlatego NIE jest w tablicy
`scopes` (`checkScopes()` wymaga wszystkich z tej listy i zablokowalby
podlaczenie Facebooka kazdemu bez Advanced Access). Po przyznaniu uprawnienia
kanal trzeba przelaczyc na nowy token: `GET /social/facebook?refresh=<channel_id>`.

### Uwagi:
- Posty mogą być tekstem, zdjęciami lub video
- Stories wymagają min. 1 załącznika

---

## 5. Instagram (via Facebook Business)

| Zmienna `.env` | Wartość |
|---|---|
| `FACEBOOK_APP_ID` | (ten sam co Facebook) |
| `FACEBOOK_APP_SECRET` | (ten sam co Facebook) |

### Redirect URL:
- `${FRONTEND_URL}/integrations/social/instagram`

### Wymagane scopes:
`instagram_basic`, `pages_show_list`, `pages_read_engagement`, `business_management`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`

### Wymagania:
- Konto Instagram **musi** być kontem Business
- Konto musi być połączone z Facebook Page
- Max 10 mediów w carousel
- Aspect ratio: 4:5 do 1.91:1

---

## 6. Instagram Standalone

Używa tych samych credentials co Instagram standardowy (Facebook App). Obsługuje konta bez połączenia z Business Manager.

---

## 7. Threads

| Zmienna `.env` | Wartość |
|---|---|
| `THREADS_APP_ID` | App ID |
| `THREADS_APP_SECRET` | App Secret |

### Jak uzyskać:
1. Na [developers.facebook.com](https://developers.facebook.com/) dodaj produkt "Threads API"
2. Skonfiguruj redirect URI:
   - `${FRONTEND_URL}/integrations/social/threads`

### Wymagane scopes:
`threads_basic`, `threads_content_publish`, `threads_manage_replies`, `threads_manage_insights`

### Uwagi:
- Token odświeża się co 58 dni automatycznie

---

## 8. YouTube

| Zmienna `.env` | Wartość |
|---|---|
| `YOUTUBE_CLIENT_ID` | OAuth 2.0 Client ID |
| `YOUTUBE_CLIENT_SECRET` | Client Secret |

### Jak uzyskać:
1. Idź na [console.cloud.google.com](https://console.cloud.google.com/)
2. Utwórz projekt, włącz YouTube Data API v3
3. Utwórz OAuth 2.0 Client ID (Web application)
4. Authorized redirect URIs:
   - `${FRONTEND_URL}/integrations/social/youtube`

### Wymagane scopes:
`userinfo.profile`, `userinfo.email`, `youtube`, `youtube.force-ssl`, `youtube.readonly`, `youtube.upload`, `youtubepartner`, `yt-analytics.readonly`

### Uwagi:
- Wymaga jednego video na post (nie może być pusty)
- YouTube ma limity upload quota

---

## 9. Google My Business (GMB)

Używa tych samych Google credentials co YouTube (`YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`).

### Redirect URL:
- `${FRONTEND_URL}/integrations/social/gmb`

### Dodatkowy scope:
`https://www.googleapis.com/auth/business.manage`

### Jak włączyć:
1. W Google Cloud Console włącz:
   - My Business Account Management API
   - My Business Business Information API
   - Business Profile Performance API
2. Dodaj redirect URI dla GMB

### Uwagi:
- Max 1 zdjęcie na post (bez video)
- Obsługuje posty EVENT i OFFER

---

## 10. Gmail

| Zmienna `.env` | Wartość |
|---|---|
| `GOOGLE_GMAIL_CLIENT_ID` | (opcjonalnie, fallback do YOUTUBE_CLIENT_ID) |
| `GOOGLE_GMAIL_CLIENT_SECRET` | (opcjonalnie, fallback do YOUTUBE_CLIENT_SECRET) |

### Redirect URL:
- `${FRONTEND_URL}/integrations/social/gmail`

### Wymagany scope:
`https://www.googleapis.com/auth/gmail.send`

### Uwagi:
- Jeśli `GOOGLE_GMAIL_CLIENT_ID` nie jest ustawiony, używa YouTube credentials
- Posty = emaile (message body jako treść, subject + recipients w ustawieniach)

---

## 11. TikTok

| Zmienna `.env` | Wartość |
|---|---|
| `TIKTOK_CLIENT_ID` | Client Key |
| `TIKTOK_CLIENT_SECRET` | Client Secret |

### Jak uzyskać:
1. Idź na [developers.tiktok.com](https://developers.tiktok.com/)
2. Utwórz aplikację
3. Dodaj Products: "Login Kit" + "Content Posting API"
4. Redirect URI:
   - `${FRONTEND_URL}/integrations/social/tiktok`

### Wymagane scopes:
`user.info.basic`, `video.publish`, `video.upload`, `user.info.profile`, `user.info.stats`

`video.list` is optional. Enable it to use video-level analytics and identify
missing TikTok content in the media flow.

### Uwagi:
- Wymagany min. 1 video LUB 1+ zdjęć (nie może być pusty)
- Video min. 720p
- Wymaga zatwierdzenia aplikacji (audit) do public posting

---

## 12. Pinterest

| Zmienna `.env` | Wartość |
|---|---|
| `PINTEREST_CLIENT_ID` | App ID |
| `PINTEREST_CLIENT_SECRET` | App Secret |

### Jak uzyskać:
1. Idź na [developers.pinterest.com](https://developers.pinterest.com/)
2. Utwórz aplikację
3. Redirect URI:
   - `${FRONTEND_URL}/integrations/social/pinterest`

### Wymagane scopes:
`boards:read`, `boards:write`, `pins:read`, `pins:write`, `user_accounts:read`

### Uwagi:
- Wymaga min. 1 medium na post
- Max 5 zdjęć LUB 1 video (video wymaga cover image jako drugi załącznik)

---

## 13. Dribbble

| Zmienna `.env` | Wartość |
|---|---|
| `DRIBBBLE_CLIENT_ID` | Client ID |
| `DRIBBBLE_CLIENT_SECRET` | Client Secret |

### Jak uzyskać:
1. Idź na [dribbble.com/account/applications](https://dribbble.com/account/applications)
2. Utwórz nową aplikację
3. Callback URL:
   - `${FRONTEND_URL}/integrations/social/dribbble`

---

## 14. Discord

| Zmienna `.env` | Wartość |
|---|---|
| `DISCORD_CLIENT_ID` | Application ID |
| `DISCORD_CLIENT_SECRET` | Client Secret |
| `DISCORD_BOT_TOKEN_ID` | Bot Token |

### Jak uzyskać:
1. Idź na [discord.com/developers/applications](https://discord.com/developers/applications)
2. Utwórz aplikację
3. W sekcji "Bot" — stwórz bota i skopiuj token
4. W sekcji "OAuth2":
   - Redirect URL: `${FRONTEND_URL}/integrations/social/discord`
   - Scopes: `bot`, `identify`, `guilds`
   - Bot Permissions: Send Messages, Embed Links, Attach Files, Manage Webhooks

### Uwagi:
- Bot musi być zaproszony na serwer
- Max 1980 znaków na wiadomość
- Edytor markdown

---

## 15. Slack

| Zmienna `.env` | Wartość |
|---|---|
| `SLACK_ID` | Client ID |
| `SLACK_SECRET` | Client Secret |
| `SLACK_SIGNING_SECRET` | Signing Secret |

### Jak uzyskać:
1. Idź na [api.slack.com/apps](https://api.slack.com/apps)
2. Utwórz aplikację "From scratch"
3. W "OAuth & Permissions" dodaj redirect URL:
   - `${FRONTEND_URL}/integrations/social/slack`
4. Bot Token Scopes:
   - `channels:read`, `chat:write`, `users:read`, `groups:read`, `channels:join`, `chat:write.customize`
5. Install app to workspace

### Uwagi:
- Token nigdy nie wygasa (permanentny bot token)
- Bot musi być zaproszony na kanał

---

## 16. Kick

| Zmienna `.env` | Wartość |
|---|---|
| `KICK_CLIENT_ID` | Client ID |
| `KICK_SECRET` | Client Secret |

### Jak uzyskać:
1. Idź na [kick.com/developers](https://kick.com/) (Developer Portal)
2. Utwórz OAuth aplikację
3. Redirect URI:
   - `${FRONTEND_URL}/integrations/social/kick`

### Wymagane scopes:
`chat:write`, `user:read`, `channel:read`

### Uwagi:
- Max 500 znaków na wiadomość (chat message)
- Używa PKCE (S256)

---

## 17. Twitch

| Zmienna `.env` | Wartość |
|---|---|
| `TWITCH_CLIENT_ID` | Client ID |
| `TWITCH_CLIENT_SECRET` | Client Secret |

### Jak uzyskać:
1. Idź na [dev.twitch.tv/console](https://dev.twitch.tv/console)
2. Zarejestruj aplikację
3. OAuth Redirect URL:
   - `${FRONTEND_URL}/integrations/social/twitch`

### Wymagane scopes:
`user:write:chat`, `user:read:chat`, `moderator:manage:announcements`

### Uwagi:
- Max 500 znaków
- Obsługuje wiadomości chat i announcements (z kolorami)

---

## 18. Mastodon

| Zmienna `.env` | Wartość |
|---|---|
| `MASTODON_URL` | URL instancji (domyślnie `https://mastodon.social`) |
| `MASTODON_CLIENT_ID` | Client ID |
| `MASTODON_CLIENT_SECRET` | Client Secret |

### Jak uzyskać:
1. Na wybranej instancji Mastodon idź do Settings → Development → New application
2. Scopes: `write:statuses`, `profile`, `write:media`
3. Redirect URI:
   - `${FRONTEND_URL}/integrations/social/mastodon`
4. Skopiuj Client ID i Client Secret

### Uwagi:
- Max 500 znaków
- Token nigdy nie wygasa

---

## 19. Reddit

| Zmienna `.env` | Wartość |
|---|---|
| `REDDIT_CLIENT_ID` | App ID |
| `REDDIT_CLIENT_SECRET` | App Secret |

### Jak uzyskać:
1. Idź na [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps)
2. Utwórz app typu "web app"
3. Redirect URI:
   - `${FRONTEND_URL}/integrations/social/reddit`

### Wymagane scopes:
`read`, `identity`, `submit`, `flair`

### Uwagi:
- Strict rate limits (1 request/s)
- Obsługuje posty z mediami i linkami

---

## 20. VK (VKontakte)

| Zmienna `.env` | Wartość |
|---|---|
| `VK_ID` | App ID |

### Jak uzyskać:
1. Idź na [vk.com/editapp?act=create](https://vk.com/editapp?act=create)
2. Utwórz standalone-app
3. W ustawieniach:
   - Redirect URI: `${FRONTEND_URL}/integrations/social/vk`
   - Włącz: Open API

### Wymagane scopes:
`vkid.personal_info`, `email`, `wall`, `status`, `docs`, `photos`, `video`

### Uwagi:
- Używa PKCE (S256)
- Max 2048 znaków
- Obsługuje zdjęcia i video

---

## 21. Bluesky

**Nie wymaga zmiennych `.env`** — użytkownik podaje dane bezpośrednio w UI.

### Custom fields (użytkownik wpisuje):
| Pole | Opis |
|---|---|
| `service` | URL instancji (domyślnie `https://bsky.social`) |
| `identifier` | Handle lub email |
| `password` | Hasło aplikacyjne (App Password) |

### Jak podłączyć:
1. Idź na [bsky.app/settings/app-passwords](https://bsky.app/settings/app-passwords)
2. Utwórz "App Password"
3. W PostSider podaj swój handle i wygenerowane hasło

### Uwagi:
- Max 300 znaków
- Max 4 zdjęcia LUB 1 video na post
- **Nie** obsługuje 2FA (trzeba wyłączyć)

---

## 22. Lemmy

**Nie wymaga zmiennych `.env`** — użytkownik podaje dane bezpośrednio w UI.

### Custom fields (użytkownik wpisuje):
| Pole | Opis |
|---|---|
| `service` | URL instancji (domyślnie `https://lemmy.world`) |
| `identifier` | Nazwa użytkownika |
| `password` | Hasło |

### Uwagi:
- Max 10000 znaków
- Obsługuje cover image (1 zdjęcie)
- Posty publikowane na wybranych communities

---

## 23. Farcaster (Warpcast)

| Zmienna `.env` | Wartość |
|---|---|
| `NEYNAR_SECRET_KEY` | Neynar API Key |
| `NEYNAR_CLIENT_ID` | Neynar Client ID |

### Jak uzyskać:
1. Idź na [neynar.com](https://neynar.com/)
2. Utwórz konto i projekt
3. Skopiuj API Key i Client ID

### Uwagi:
- Max 800 znaków
- Tylko zdjęcia (brak video)
- Użytkownik autoryzuje się przez Neynar Sign-in popup

---

## 24. Telegram

| Zmienna `.env` | Wartość |
|---|---|
| `TELEGRAM_TOKEN` | Bot Token |

### Jak uzyskać:
1. Otwórz Telegram i napisz do [@BotFather](https://t.me/BotFather)
2. Użyj `/newbot` aby stworzyć bota
3. Skopiuj token bota

### Jak podłączyć kanał/grupę:
1. Dodaj bota do kanału/grupy jako admina
2. W PostSider podaj ID chatu lub użyj `/connect {kod}` w kanale
3. Bot musi mieć uprawnienia administratora (do usuwania wiadomości)

### Uwagi:
- Max 4096 znaków
- Obsługuje HTML formatting
- Max 10 mediów w grupie

---

## 25. Nostr

**Nie wymaga zmiennych `.env`** — użytkownik podaje dane bezpośrednio w UI.

### Custom fields (użytkownik wpisuje):
| Pole | Opis |
|---|---|
| `password` | Klucz prywatny Nostr (HEX format) |

### Jak uzyskać klucz:
1. Wygeneruj klucz na [iris.to](https://iris.to) lub innym kliencie Nostr
2. Wyeksportuj klucz prywatny w formacie HEX

### Uwagi:
- Max 100000 znaków
- Publikuje na wielu relay jednocześnie (nos.lol, relay.damus.io, relay.snort.social, itp.)

---

## 26. WordPress

**Nie wymaga zmiennych `.env`** — użytkownik podaje dane bezpośrednio w UI.

### Custom fields (użytkownik wpisuje):
| Pole | Opis |
|---|---|
| `domain` | URL WordPress (np. `https://myblog.com`) |
| `username` | Nazwa użytkownika WP |
| `password` | Hasło lub Application Password |

### Jak podłączyć:
1. W WordPress włącz REST API (domyślnie włączone)
2. Utwórz Application Password: Users → Twój profil → Application Passwords
3. Podaj dane w PostSider

### Uwagi:
- Edytor HTML
- Obsługuje custom post types
- Max 100000 znaków

---

## 27. Medium

**Nie wymaga zmiennych `.env`** — używa Integration Token użytkownika.

### Jak podłączyć:
1. Idź na [medium.com/me/settings](https://medium.com/me/settings)
2. Sekcja "Security and apps" → Integration tokens
3. Wygeneruj token i podaj go w PostSider

---

## 28. Dev.to

**Nie wymaga zmiennych `.env`** — używa API Key użytkownika.

### Jak podłączyć:
1. Idź na [dev.to/settings/extensions](https://dev.to/settings/extensions)
2. Wygeneruj DEV API Key
3. Podaj key w PostSider

---

## 29. Hashnode

**Nie wymaga zmiennych `.env`** — używa Personal Access Token.

### Jak podłączyć:
1. Idź na [hashnode.com/settings/developer](https://hashnode.com/settings/developer)
2. Wygeneruj Personal Access Token
3. Podaj token w PostSider

---

## 30. Ghost

**Nie wymaga zmiennych `.env`** — użytkownik podaje dane w UI.

### Custom fields (użytkownik wpisuje):
| Pole | Opis |
|---|---|
| Domain/URL | URL instancji Ghost |
| Admin API Key | Ghost Admin API Key |

### Jak uzyskać:
1. W panelu Ghost: Settings → Integrations → Add custom integration
2. Skopiuj Admin API Key

---

## 31. Notion

**Nie wymaga zmiennych `.env`** — używa Internal Integration Token.

### Jak podłączyć:
1. Idź na [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Utwórz nową integrację
3. Skopiuj "Internal Integration Secret"
4. W Notion udostępnij wybraną bazę/stronę tej integracji

---

## 32. Bear Blog

**Nie wymaga zmiennych `.env`** — użytkownik podaje dane w UI.

### Jak podłączyć:
- Podaj swój Bear Blog URL i token API

---

## 33. Mataroa

**Nie wymaga zmiennych `.env`** — użytkownik podaje dane w UI.

### Jak podłączyć:
- Podaj API key z panelu Mataroa (Settings → API)

---

## 34. Write.as

**Nie wymaga zmiennych `.env`** — użytkownik podaje dane w UI.

### Jak podłączyć:
- Podaj swoje credentials (username/password) Write.as

---

## 35. Listmonk (newsletter)

| Zmienna `.env` | Wartość |
|---|---|
| `LISTMONK_DOMAIN` | URL instancji Listmonk |
| `LISTMONK_USER` | Użytkownik admin |
| `LISTMONK_API_KEY` | API Key |
| `LISTMONK_LIST_ID` | ID listy mailingowej |

### Jak uzyskać:
1. Zainstaluj [Listmonk](https://listmonk.app/) (self-hosted)
2. W Settings → API skopiuj credentials
3. Podaj ID listy, na którą chcesz wysyłać

---

## 36. Moltbook

**Nie wymaga zmiennych `.env`** — integracja przez Chrome Extension.

### Uwagi:
- Wymaga ustawienia `EXTENSION_ID` w `.env`
- Działa przez rozszerzenie przeglądarki

---

## 37. Skool

**Nie wymaga zmiennych `.env`** — integracja przez Chrome Extension.

### Uwagi:
- Wymaga ustawienia `EXTENSION_ID` w `.env`
- Działa przez rozszerzenie przeglądarki (cookie-based)

---

## 38. Whop

**Nie wymaga zmiennych `.env`** — integracja przez Chrome Extension.

### Uwagi:
- Wymaga ustawienia `EXTENSION_ID` w `.env`
- Działa przez rozszerzenie przeglądarki

---

## 39. MeWe

**Nie wymaga zmiennych `.env`** — integracja przez Chrome Extension.

### Uwagi:
- Wymaga ustawienia `EXTENSION_ID` w `.env`

---

## 40. Rumble

**Nie wymaga zmiennych `.env`** — użytkownik podaje dane w UI.

### Custom fields (użytkownik wpisuje):
| Pole | Opis |
|---|---|
| `channelUrl` | URL kanału Rumble (np. `https://rumble.com/c/MojKanal`) |
| `apiKey` | API Key z Rumble Studio |

### Uwagi:
- Rumble **nie ma** jeszcze publicznego API do publikacji
- PostSider rejestruje post i daje link do kanału — użytkownik musi opublikować ręcznie w Rumble Studio

---

## Podsumowanie zmiennych `.env`

```env
# === Social Media Channels ===

# X (Twitter)
X_API_KEY=""
X_API_SECRET=""

# LinkedIn
LINKEDIN_CLIENT_ID=""
LINKEDIN_CLIENT_SECRET=""

# Facebook + Instagram
FACEBOOK_APP_ID=""
FACEBOOK_APP_SECRET=""

# Threads
THREADS_APP_ID=""
THREADS_APP_SECRET=""

# YouTube + GMB + Gmail
YOUTUBE_CLIENT_ID=""
YOUTUBE_CLIENT_SECRET=""

# Gmail (opcjonalnie oddzielne credentials)
GOOGLE_GMAIL_CLIENT_ID=""
GOOGLE_GMAIL_CLIENT_SECRET=""

# TikTok
TIKTOK_CLIENT_ID=""
TIKTOK_CLIENT_SECRET=""

# Pinterest
PINTEREST_CLIENT_ID=""
PINTEREST_CLIENT_SECRET=""

# Dribbble
DRIBBBLE_CLIENT_ID=""
DRIBBBLE_CLIENT_SECRET=""

# Discord
DISCORD_CLIENT_ID=""
DISCORD_CLIENT_SECRET=""
DISCORD_BOT_TOKEN_ID=""

# Slack
SLACK_ID=""
SLACK_SECRET=""
SLACK_SIGNING_SECRET=""

# Kick
KICK_CLIENT_ID=""
KICK_SECRET=""

# Twitch
TWITCH_CLIENT_ID=""
TWITCH_CLIENT_SECRET=""

# Mastodon
MASTODON_URL="https://mastodon.social"
MASTODON_CLIENT_ID=""
MASTODON_CLIENT_SECRET=""

# Reddit
REDDIT_CLIENT_ID=""
REDDIT_CLIENT_SECRET=""

# VK
VK_ID=""

# Farcaster (via Neynar)
NEYNAR_SECRET_KEY=""
NEYNAR_CLIENT_ID=""

# Telegram
TELEGRAM_TOKEN=""

# Listmonk
LISTMONK_DOMAIN=""
LISTMONK_USER=""
LISTMONK_API_KEY=""
LISTMONK_LIST_ID=""

# Chrome Extension (Skool, Moltbook, Whop, MeWe)
EXTENSION_ID=""
```

---

## Kanały bez wymagań po stronie serwera

Te kanały nie wymagają żadnych zmiennych `.env` — użytkownik podaje swoje credentiale bezpośrednio w interfejsie PostSider:

| Kanał | Co podaje użytkownik |
|---|---|
| **Bluesky** | Service URL + handle + app password |
| **Lemmy** | Instance URL + username + password |
| **Nostr** | Klucz prywatny (HEX) |
| **WordPress** | Domain + username + app password |
| **Medium** | Integration Token |
| **Dev.to** | API Key |
| **Hashnode** | Personal Access Token |
| **Ghost** | Domain + Admin API Key |
| **Notion** | Internal Integration Token |
| **Bear Blog** | URL + token |
| **Mataroa** | API Key |
| **Write.as** | Username + password |
| **Rumble** | Channel URL + API Key |
