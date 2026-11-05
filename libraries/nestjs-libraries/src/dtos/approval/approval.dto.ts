import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class RequestApprovalDto {
  @IsString()
  @MinLength(1)
  postId: string;
}

export class ResolveApprovalDto {
  @IsOptional()
  @IsString()
  note?: string;

  /** The stage position the admin was looking at; a mismatch answers 409 stage_changed. */
  @IsOptional()
  @IsInt()
  @Min(1)
  expectStage?: number;
}
