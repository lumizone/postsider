import {
  IsArray,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class UpsertHashtagGroupDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsArray()
  @IsString({ each: true })
  hashtags: string[];

  @IsOptional()
  @IsString()
  platform?: string;
}

export class UpsertCaptionTemplateDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  content: string;
}

export class UpsertUtmPresetDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  utmSource: string;

  @IsString()
  @MinLength(1)
  utmMedium: string;

  @IsString()
  @MinLength(1)
  utmCampaign: string;

  @IsOptional()
  @IsString()
  utmContent?: string;

  @IsOptional()
  @IsString()
  utmTerm?: string;
}
