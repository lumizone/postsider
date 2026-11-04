import { ApiPropertyOptional } from '@nestjs/swagger';
import { PUBLISH_ERROR_CATEGORIES } from '@postsider/nestjs-libraries/integrations/publish-error.classifier';

/**
 * Documentation-only shape of the failure fields on every public post row.
 * UNKNOWN_OUTCOME means the platform may have published the post.
 */
export class PublicPostFailureFieldsDto {
  @ApiPropertyOptional({
    enum: [...PUBLISH_ERROR_CATEGORIES],
    nullable: true,
    description:
      'Why the last publish attempt failed. UNKNOWN_OUTCOME means the platform may have published the post: check the channel before retrying. POLICY_BLOCKED means a publishing policy rule blocked the post.',
  })
  errorCategory?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Whether retrying the failed publish is expected to help.',
  })
  errorRetryable?: boolean | null;

  @ApiPropertyOptional({
    type: 'integer',
    description: 'Number of publish attempts made so far.',
  })
  publishAttempts?: number;

  @ApiPropertyOptional({
    type: 'string',
    format: 'date-time',
    nullable: true,
    description: 'When the last publish attempt started.',
  })
  lastPublishAttemptAt?: Date | null;
}
