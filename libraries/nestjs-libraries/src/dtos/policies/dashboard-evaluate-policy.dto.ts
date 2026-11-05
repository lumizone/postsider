import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsIn, IsOptional, ValidateBy, ValidateNested } from 'class-validator';
import { EvaluatePolicyDto } from './evaluate-policy.dto';

export const AS_ACTOR_TYPES = ['USER', 'API_KEY', 'OAUTH_CLIENT', 'SYSTEM'] as const;

/** Who the dry run pretends to be. The dashboard may preview another actor kind. */
export class DashboardAsActorDto {
  @ApiProperty({ enum: AS_ACTOR_TYPES })
  @IsDefined()
  @IsIn(AS_ACTOR_TYPES as unknown as string[])
  type: (typeof AS_ACTOR_TYPES)[number];

  @ApiPropertyOptional({ description: 'Only with type API_KEY. Must be a key of this organization.' })
  @IsOptional()
  @ValidateBy({
    name: 'isApiKeyIdForApiKeyActor',
    validator: {
      validate: (value: unknown, args) =>
        typeof value === 'string' &&
        value.length >= 1 &&
        value.length <= 100 &&
        (args?.object as DashboardAsActorDto | undefined)?.type === 'API_KEY',
      defaultMessage: () => 'apiKeyId must be a non-empty string and is only allowed with type API_KEY',
    },
  })
  apiKeyId?: string;
}

/**
 * Body of the dashboard policy dry run: the public dry run body plus an
 * optional actor to preview.
 */
export class DashboardEvaluatePolicyDto extends EvaluatePolicyDto {
  @ApiPropertyOptional({ type: DashboardAsActorDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DashboardAsActorDto)
  asActor?: DashboardAsActorDto;
}
