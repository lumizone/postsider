import { ApiPropertyOptional } from '@nestjs/swagger';
import { POST_ACTOR_TYPES } from '@postsider/nestjs-libraries/actor/post-actor';

const ACTOR_TYPE = {
  enum: [...POST_ACTOR_TYPES],
  nullable: true,
} as const;

/**
 * Documentation-only shape of the raw identity columns on public post rows.
 * Actor columns are verified server side from the credential. Provenance
 * columns are claims made by the caller, never proof of identity.
 */
export class PublicPostIdentityFieldsDto {
  @ApiPropertyOptional({
    ...ACTOR_TYPE,
    description: 'Verified type of the actor that created the post.',
  })
  createdByType?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'User that created the post.' })
  createdByUserId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'API key that created the post.' })
  createdByApiKeyId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'OAuth client that created the post.' })
  createdByOAuthClientId?: string | null;

  @ApiPropertyOptional({
    ...ACTOR_TYPE,
    description: 'Verified type of the actor that last modified the post.',
  })
  lastModifiedByType?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'User that last modified the post.' })
  lastModifiedByUserId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'API key that last modified the post.' })
  lastModifiedByApiKeyId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'OAuth client that last modified the post.' })
  lastModifiedByOAuthClientId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Claimed agent name (provenance, not identity).' })
  agentName?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Claimed workflow id (provenance, not identity).' })
  workflowId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Claimed run id (provenance, not identity).' })
  runId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Claimed external reference (provenance, not identity).' })
  externalRef?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Claimed source (provenance, not identity).' })
  source?: string | null;
}
