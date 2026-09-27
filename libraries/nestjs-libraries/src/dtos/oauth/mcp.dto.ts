import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Scopes the MCP authorization server can grant. `posts:read`/`posts:write`
 * gate what the remote MCP resource server may do on behalf of the user;
 * `openid`/`email` exist so OAuth clients that expect OIDC-style scope values
 * (the OpenAI plugin flow asks for them) can request what they need without
 * being rejected — the UserInfo endpoint is what actually serves the claims.
 */
export const MCP_SUPPORTED_SCOPES: readonly string[] = [
  'posts:read',
  'posts:write',
  'openid',
  'email',
];

/** Dynamic Client Registration request (RFC 7591). */
export class McpRegisterDto {
  @IsString()
  @IsDefined()
  @MaxLength(200)
  client_name: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  redirect_uris: string[];

  @IsString()
  @IsOptional()
  @IsIn(['none', 'client_secret_post'])
  token_endpoint_auth_method?: string;

  @IsString()
  @IsOptional()
  @MaxLength(400)
  scope?: string;
}

/**
 * Authorization request. Extends the legacy set with the PKCE parameters: when
 * `code_challenge` is present the request is routed to the MCP DCR flow.
 */
export class McpAuthorizeQueryDto {
  @IsString()
  @IsDefined()
  client_id: string;

  @IsString()
  @IsDefined()
  @IsIn(['code'])
  response_type: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  redirect_uri?: string;

  @IsString()
  @IsOptional()
  code_challenge?: string;

  @IsString()
  @IsOptional()
  @IsIn(['S256'])
  code_challenge_method?: string;

  @IsString()
  @IsOptional()
  scope?: string;
}

/**
 * Token request. Superset of the legacy DTO: the MCP flow adds code_verifier
 * (public clients, PKCE) and refresh_token, and makes client_secret and code
 * optional (a public client has no secret; a refresh has no code).
 */
export class McpTokenDto {
  @IsString()
  @IsDefined()
  grant_type: string;

  @IsString()
  @IsDefined()
  client_id: string;

  @IsString()
  @IsOptional()
  client_secret?: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  code_verifier?: string;

  @IsString()
  @IsOptional()
  refresh_token?: string;

  @IsString()
  @IsOptional()
  redirect_uri?: string;
}

/** RFC 7662 introspection request. */
export class McpIntrospectDto {
  @IsString()
  @IsDefined()
  token: string;

  @IsString()
  @IsOptional()
  token_type_hint?: string;
}

/** RFC 7009 revocation request. */
export class McpRevokeDto {
  @IsString()
  @IsDefined()
  token: string;

  @IsString()
  @IsOptional()
  token_type_hint?: string;
}

/** Consent decision posted by the consent page (session-authenticated). */
export class McpConsentDto {
  @IsString()
  @IsDefined()
  request_id: string;

  @IsString()
  @IsOptional()
  organization_id?: string;

  @IsString()
  @IsDefined()
  @IsIn(['approve', 'deny'])
  action: 'approve' | 'deny';

  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  scopes?: string[];
}
