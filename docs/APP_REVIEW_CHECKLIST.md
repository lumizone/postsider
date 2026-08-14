# Platform App Review Checklist

Stan na 2026-07-14. Checklista do przejścia review/weryfikacji u providerów dla
`app.postsider.com` (cloud). Audyt gotowości: kod integracji kompletny dla
wszystkich platform; braki były po stronie compliance i są odhaczane niżej.

Wspólne zasoby (używane w każdym formularzu):

- Homepage: `https://postsider.com` (linkuje privacy + terms w stopce)
- Privacy Policy: `https://postsider.com/privacy`
- Terms of Service: `https://postsider.com/terms`
- Data deletion (instrukcje, landing): `https://postsider.com/data-deletion` —
  strona po stronie landingu (Netlify); callback zwraca ten URL przez env
  `DATA_DELETION_URL`. **Przed wysłaniem wniosków sprawdzić, że nie 404-uje**
  (na 2026-07-14 jeszcze niewdrożona).
- Redirect URI (każda platforma): `https://app.postsider.com/integrations/social/<identifier>`
- Kontakt: `lukasz@postsider.com`

## Meta (Facebook + Instagram via Business) — app `FACEBOOK_APP_ID`

Konsola: developers.facebook.com > App settings > Basic.

- [ ] Privacy Policy URL: `https://postsider.com/privacy`
- [ ] Terms of Service URL: `https://postsider.com/terms`
- [ ] **Data Deletion Request URL**: `https://api.postsider.com/meta/data-deletion/facebook`
      (callback w backendzie, `meta.compliance.controller.ts`; weryfikuje
      `signed_request`, kasuje kanały + tokeny usera, zwraca `confirmation_code`
      i URL statusu)
- [ ] Deauthorize Callback URL: `https://api.postsider.com/meta/deauthorize/facebook`
- [ ] Business verification firmy (Lumi Zone Łukasz Blania) w Business Managerze
- [ ] App Review (advanced access) — uprawnienia żądane przez kod
      (`facebook.provider.ts` + `instagram.provider.ts`):
      `pages_show_list`, `business_management`, `pages_manage_posts`,
      `pages_manage_engagement`, `pages_read_engagement`, `read_insights`,
      `instagram_basic`, `instagram_content_publish`,
      `instagram_manage_comments`, `instagram_manage_insights`
      — do każdego: uzasadnienie + screencast (connect flow → publikacja → analityka).
      Uwaga: `business_management` bywa najczęściej odrzucane; uzasadnić
      koniecznością listowania stron/kont IG usera.
- [ ] Ikona appki, kategoria, opis — komplet w App settings
- [ ] Tryb Live po przyznaniu uprawnień

## Meta — Instagram standalone (Instagram Login) — app `INSTAGRAM_APP_ID`

- [ ] Privacy / Terms URL jak wyżej
- [ ] **Data Deletion Request URL**: `https://api.postsider.com/meta/data-deletion/instagram`
- [ ] Deauthorize Callback URL: `https://api.postsider.com/meta/deauthorize/instagram`
- [ ] Review scope'ów (`instagram.standalone.provider.ts`):
      `instagram_business_basic`, `instagram_business_content_publish`,
      `instagram_business_manage_comments`, `instagram_business_manage_insights`

## Meta — Threads — app `THREADS_APP_ID`

- [ ] Privacy / Terms URL jak wyżej
- [ ] **Data Deletion Request URL**: `https://api.postsider.com/meta/data-deletion/threads`
- [ ] Deauthorize Callback URL: `https://api.postsider.com/meta/deauthorize/threads`
- [ ] Review scope'ów (`threads.provider.ts`): `threads_basic`,
      `threads_content_publish`, `threads_manage_insights`, `threads_manage_replies`

## Google (YouTube) — OAuth consent screen verification

Konsola: console.cloud.google.com > APIs & Services > OAuth consent screen.

- [ ] **Privacy policy: dopisać deklarację zgodności z Google API Services User
      Data Policy (w tym Limited Use)** — obok istniejącej klauzuli YouTube API
      Services — **TODO (landing)**. Istniejące wymogi YouTube (link do YouTube
      ToS, Google Privacy Policy, revoke URL) są już spełnione.
- [ ] Weryfikacja domen w Search Console: `postsider.com` + `app.postsider.com`
- [ ] Consent screen: homepage `https://postsider.com`, privacy
      `https://postsider.com/privacy`, logo (uwaga: upload logo wymusza review)
- [ ] Scopes do weryfikacji (sensitive; `youtube.provider.ts`):
      `userinfo.profile`, `userinfo.email`, `youtube.force-ssl`,
      `youtube.readonly`, `youtube.upload`
- [ ] Demo video (YouTube, unlisted): pełny OAuth flow + upload wideo z appki
- [ ] **Decyzja GMB**: provider `gmb` nie ma własnych credentiali i robi
      fallback na klucze YouTube — scope `business.manage` rozszerzy zakres
      weryfikacji tej samej appki Google. Przed wnioskiem: osobny projekt/appka
      dla GMB (`GOOGLE_GMB_CLIENT_ID/SECRET`) albo wyłączenie GMB z katalogu.

## Pinterest — trial → standard access

Konsola: developers.pinterest.com > My apps.

- [ ] Privacy / Terms URL jak wyżej
- [ ] Wniosek o standard access: opis use-case (scheduling/publikacja pinów
      przez zalogowanych userów), demo
- [ ] Scopes (`pinterest.provider.ts`): `boards:read`, `boards:write`,
      `pins:read`, `pins:write`, `user_accounts:read`
- [ ] Redirect URI: `https://app.postsider.com/integrations/social/pinterest`

## TikTok — app audit (wymagany do publicznego postowania)

Konsola: developers.tiktok.com > Manage apps. Bez audytu posty lądują jako
prywatne/draft (unaudited client).

- [ ] Privacy / Terms URL jak wyżej
- [ ] Weryfikacja domeny publikacji (pull-from-URL) w portalu
- [ ] Scopes (`tiktok.provider.ts`): `user.info.basic`, `user.info.profile`,
       `user.info.stats`, `video.publish`, `video.upload` (`video.list` is
       optional for video-level analytics)
- [ ] Demo video + uzasadnienia dla `video.publish` / `video.upload`
- [ ] Redirect URI: `https://app.postsider.com/integrations/social/tiktok`

## LinkedIn

- [ ] **Wyjaśnić rozjazd scope'ów**: kod (`linkedin.provider.ts`) żąda
      `r_basicprofile` + `w_member_social` (page: + `rw_organization_admin`,
      `w_organization_social`, `r_organization_social`); przewodnik w
      `docs/INTEGRATION_SETUP_GUIDE.md` mówi `openid, profile, email`.
      `r_basicprofile` wymaga programu partnerskiego / Community Management API
      — potwierdzić, które produkty appka ma przyznane, i dostosować kod albo
      wniosek.
- [ ] Redirect URIs: `https://app.postsider.com/integrations/social/linkedin`
      + `/linkedin-page`

## X (Twitter)

- Brak klasycznego review; OAuth 1.0a. Wymagany wykupiony tier API zgodny z
  wolumenem publikacji. Callback: `https://app.postsider.com/integrations/social/x`.

## Endpointy compliance w tym repo

| Endpoint | Metoda | Opis |
|---|---|---|
| `/meta/data-deletion/:app` | POST | Meta Data Deletion Request callback (`:app` ∈ facebook, instagram, threads). Weryfikuje `signed_request` HMAC-SHA256 sekretem appki, soft-deletuje integracje usera (`deletedAt` + `disabled` + wyczyszczone tokeny), zwraca `{url, confirmation_code}`. `url` = `DATA_DELETION_URL` (cloud: landing `/data-deletion`), fallback: wbudowana strona statusu niżej. |
| `/meta/deauthorize/:app` | POST | Meta Deauthorize callback — oznacza integracje usera jako `disabled` + `refreshNeeded` (dane zostają, token i tak jest unieważniony po stronie Mety). |
| `/meta/data-deletion/status?code=` | GET | Strona statusu (HTML) pokazywana userowi przez Meta po żądaniu usunięcia danych. |

Publicznie (nginx): `https://api.postsider.com/meta/...` oraz
`https://app.postsider.com/api/meta/...` (ten sam backend).

## Poza tym repo (landing / konsole)

1. Landing: opublikować stronę `https://postsider.com/data-deletion`
   (instrukcja: usuń konto w Settings > Security albo napisz na
   lukasz@postsider.com; wspomnieć callback Mety) — w toku po stronie landingu.
2. Landing: dopisek Limited Use (Google) + wymienić "Instagram" z nazwy w
   privacy policy.
3. Wpisanie powyższych URL-i w konsolach developerskich (Meta ×3, Google,
   Pinterest, TikTok, LinkedIn).
