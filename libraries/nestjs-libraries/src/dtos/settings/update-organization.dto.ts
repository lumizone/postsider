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
}
