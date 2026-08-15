import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  logo?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  defaultTimezone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  referralSource?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  brandVoice?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  brandAudience?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  brandRules?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  brandForbiddenWords?: string | null;
}
