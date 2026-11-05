import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ACTIVITY_BUCKETS,
  ActivityBucket,
} from '@postsider/nestjs-libraries/agent-activity/activity-buckets';

const splitIds = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
    : value;

const toNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() !== '' ? Number(value) : value;

export class ListAgentActivityDto {
  @IsOptional()
  @IsIn(ACTIVITY_BUCKETS as unknown as string[])
  bucket?: ActivityBucket = 'attention';

  @IsOptional()
  @IsIn(['relevant', 'automation'])
  scope?: 'relevant' | 'automation' = 'relevant';

  @IsOptional()
  @Transform(splitIds)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  integrationIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  actor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  agentName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  source?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 25;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  cursor?: string;
}
