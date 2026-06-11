# Requirements Document

## Introduction

PostSider is a social media post scheduling SaaS. Today, when a user connects a social channel, the connect UI can offer up to three options: "Sign in with OAuth", "Setup OAuth" (where the user pastes their own Client ID / Secret), and "Enter credentials manually" (paste API key / token). This is a self-hosted-style model that is wrong for a managed SaaS product.

This feature reworks the channel connect experience to match a managed SaaS model:

- The PostSider operator (the platform) configures OAuth applications once, at the platform level, via server environment variables / secrets. End users never paste a Client ID / Secret and never see an OAuth setup form.
- For platforms that support OAuth, users get a single, clean one-click "Connect" action that redirects to the provider's authorization screen and returns with the account connected.
- For platforms that have no OAuth flow (API-key-only providers such as Dev.to, Hashnode, Bluesky, Telegram, Nostr, WordPress, Ghost, etc.), users keep the existing API key / token entry form.
- When an OAuth platform has not yet been configured by the operator, users see that the platform is currently unavailable instead of being asked to provide credentials.

This spec covers the frontend preparation effort first, plus the supporting contract changes needed so the frontend can render the correct experience and so the operator can enable platforms one by one (starting with X and Meta).

All work is scoped to `PostSider_APP`. The separate `PostSider_OSS` folder MUST NOT be touched.

## Glossary

- **PostSider**: The social media scheduling SaaS application under `PostSider_APP`.
- **Operator**: The PostSider platform owner who deploys and configures the application, including OAuth application credentials, via server environment variables / secrets.
- **End_User**: A customer who uses PostSider to connect channels and schedule posts.
- **Connect_UI**: The frontend flow that lets an End_User connect a social channel, currently driven by `apps/frontend/src/components/calendar.tsx` (function `addChannelForPlatform`), `connect-method-modal.tsx`, and `custom-fields-modal.tsx`.
- **Platform_Provider**: A social/publishing destination (X, Meta/Facebook, Instagram, LinkedIn, Dev.to, Hashnode, Bluesky, etc.) defined under `libraries/nestjs-libraries/src/integrations/social/*.provider.ts`.
- **OAuth_Platform**: A Platform_Provider that supports an OAuth authorization-code flow (e.g. X, Facebook, Instagram, LinkedIn).
- **ApiKey_Platform**: A Platform_Provider that has no OAuth flow and is connected by entering an API key / token (e.g. Dev.to, Hashnode, Bluesky, Telegram, Nostr, WordPress, Ghost).
- **Platform_Credentials**: The Client ID / Client Secret for an OAuth_Platform's OAuth application, supplied by the Operator at the platform level.
- **Configured_Platform**: An OAuth_Platform for which valid Platform_Credentials are present in the server environment.
- **Unconfigured_Platform**: An OAuth_Platform for which Platform_Credentials are absent or incomplete in the server environment.
- **Connect_Action**: A single one-click control labeled "Connect {platform}" that starts the OAuth authorization-code flow for a Configured_Platform.
- **Credential_Form**: The API key / token entry form (`custom-fields-modal.tsx`) used to connect an ApiKey_Platform.
- **Integration_Url_Endpoint**: The backend endpoint `GET /integrations/social/:integration` (`getIntegrationUrl` in `integrations.controller.ts`) that the Connect_UI calls to determine how to connect a Platform_Provider.

## Requirements

### Requirement 1: Platform connection-type classification

**User Story:** As an End_User, I want each platform to present only the connection method it actually supports, so that I am not confused by irrelevant options.

#### Acceptance Criteria

1. THE Integration_Url_Endpoint SHALL classify each Platform_Provider as exactly one of OAuth_Platform or ApiKey_Platform.
2. WHEN the Connect_UI requests connection information for an OAuth_Platform, THE Integration_Url_Endpoint SHALL indicate that the platform uses the OAuth connection method.
3. WHEN the Connect_UI requests connection information for an ApiKey_Platform, THE Integration_Url_Endpoint SHALL indicate that the platform uses the API key connection method.
4. WHERE a Platform_Provider is classified as an OAuth_Platform, THE Integration_Url_Endpoint SHALL NOT return API key credential field definitions for that platform.

### Requirement 2: One-click connect for configured OAuth platforms

**User Story:** As an End_User, I want to connect an OAuth platform with a single click, so that connecting a channel is fast and requires no technical setup.

#### Acceptance Criteria

1. WHEN an End_User opens the Connect_UI for a Configured_Platform, THE Connect_UI SHALL present a single Connect_Action labeled "Connect {platform}".
2. WHEN an End_User activates the Connect_Action for a Configured_Platform, THE Connect_UI SHALL redirect the browser to the provider authorization URL returned by the Integration_Url_Endpoint.
3. WHILE the Connect_UI is showing a Configured_Platform, THE Connect_UI SHALL NOT display an OAuth setup form.
4. WHILE the Connect_UI is showing a Configured_Platform, THE Connect_UI SHALL NOT display an API key entry option.
5. WHEN the provider authorization flow returns successfully, THE PostSider SHALL connect the channel and refresh the End_User's channel list.

### Requirement 3: Operator-managed platform credentials

**User Story:** As the Operator, I want to configure OAuth application credentials once at the platform level, so that all End_Users can connect without supplying their own credentials.

#### Acceptance Criteria

1. THE PostSider SHALL read Platform_Credentials for each OAuth_Platform from the server environment configuration.
2. WHEN Platform_Credentials for an OAuth_Platform are present and complete in the server environment, THE Integration_Url_Endpoint SHALL treat that platform as a Configured_Platform.
3. WHEN Platform_Credentials for an OAuth_Platform are absent or incomplete in the server environment, THE Integration_Url_Endpoint SHALL treat that platform as an Unconfigured_Platform.
4. THE Integration_Url_Endpoint SHALL NOT expose Platform_Credentials values to the Connect_UI.

### Requirement 4: Remove end-user OAuth setup and manual entry for OAuth platforms

**User Story:** As an End_User, I want OAuth platforms to never ask me for a Client ID, Secret, or API key, so that I am not exposed to operator-level configuration.

#### Acceptance Criteria

1. THE Connect_UI SHALL NOT present a "Setup OAuth" option for any OAuth_Platform.
2. THE Connect_UI SHALL NOT present an API key / token entry form for any OAuth_Platform.
3. THE Connect_UI SHALL NOT present a Client ID input or Client Secret input to the End_User for any Platform_Provider.
4. THE Integration_Url_Endpoint SHALL NOT return OAuth setup field definitions to the Connect_UI for any Platform_Provider.

### Requirement 5: Unconfigured OAuth platform shown as unavailable

**User Story:** As an End_User, I want to see when an OAuth platform is not yet available, so that I understand I cannot connect it instead of being asked for credentials.

#### Acceptance Criteria

1. WHEN an End_User opens the Connect_UI for an Unconfigured_Platform, THE Connect_UI SHALL display a message that the platform is currently unavailable.
2. WHILE the Connect_UI is showing an Unconfigured_Platform, THE Connect_UI SHALL disable the Connect_Action for that platform.
3. WHILE the Connect_UI is showing an Unconfigured_Platform, THE Connect_UI SHALL NOT present an API key entry form for that platform.
4. WHILE the Connect_UI is showing an Unconfigured_Platform, THE Connect_UI SHALL NOT present an OAuth setup form for that platform.

### Requirement 6: Preserve API key entry for non-OAuth platforms

**User Story:** As an End_User, I want to connect API-key-only platforms by entering my key or token, so that I can still use platforms that have no OAuth flow.

#### Acceptance Criteria

1. WHEN an End_User opens the Connect_UI for an ApiKey_Platform, THE Connect_UI SHALL present the Credential_Form with the field definitions returned by the Integration_Url_Endpoint.
2. WHEN an End_User submits valid credentials in the Credential_Form for an ApiKey_Platform, THE PostSider SHALL connect the channel and refresh the End_User's channel list.
3. IF an End_User submits credentials in the Credential_Form that PostSider rejects, THEN THE Connect_UI SHALL display a descriptive error message and keep the Credential_Form open.
4. WHILE the Connect_UI is showing an ApiKey_Platform, THE Connect_UI SHALL NOT present a Connect_Action.

### Requirement 7: Incremental platform enablement

**User Story:** As the Operator, I want to enable OAuth platforms one at a time, so that I can roll out X and Meta first and add others later without code changes.

#### Acceptance Criteria

1. WHERE the Operator has configured Platform_Credentials for a specific OAuth_Platform, THE Connect_UI SHALL present that platform as a Configured_Platform.
2. WHERE the Operator has not configured Platform_Credentials for a specific OAuth_Platform, THE Connect_UI SHALL present that platform as an Unconfigured_Platform.
3. WHEN the Operator changes the configured set of Platform_Credentials, THE Connect_UI SHALL reflect the updated availability of each platform on the next request to the Integration_Url_Endpoint.

### Requirement 8: Resilient connection-information handling

**User Story:** As an End_User, I want the connect flow to behave predictably when something goes wrong, so that I am not left in a broken or ambiguous state.

#### Acceptance Criteria

1. IF the Integration_Url_Endpoint fails to return connection information for a Platform_Provider, THEN THE Connect_UI SHALL display an error message indicating the platform cannot be connected right now.
2. IF a requested Platform_Provider is not an allowed integration, THEN THE Integration_Url_Endpoint SHALL return an error response.
3. WHEN the Connect_UI receives connection information for a Configured_Platform that omits a provider authorization URL, THE Connect_UI SHALL treat the platform as an Unconfigured_Platform.
