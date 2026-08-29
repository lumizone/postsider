import { IsOptional, IsString, MinLength } from 'class-validator';

export class RequestApprovalDto {
  @IsString()
  @MinLength(1)
  postId: string;
}

export class ResolveApprovalDto {
  @IsOptional()
  @IsString()
  note?: string;
}
