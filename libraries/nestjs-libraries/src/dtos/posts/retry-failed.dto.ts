import { IsBoolean, IsOptional } from 'class-validator';

export class RetryFailedPostsDto {
  @IsOptional()
  @IsBoolean()
  includeUnknownOutcome?: boolean;
}
