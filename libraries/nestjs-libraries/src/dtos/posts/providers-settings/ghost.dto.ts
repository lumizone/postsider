import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MediaDto } from '@postsider/nestjs-libraries/dtos/media/media.dto';

export class GhostTagsSettings {
  @IsString()
  value: string;

  @IsString()
  label: string;
}

export class GhostDto {
  @IsString()
  @MinLength(2)
  @IsDefined()
  title: string;

  @IsString()
  @IsOptional()
  excerpt?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  feature_image?: MediaDto;

  @IsOptional()
  @IsString()
  @ValidateIf((o) => o.canonical && o.canonical.indexOf('(post:') === -1)
  @Matches(
    /^(|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})$/,
    {
      message: 'Invalid URL',
    }
  )
  canonical?: string;

  @IsArray()
  @IsOptional()
  @Type(() => GhostTagsSettings)
  @ValidateNested({ each: true })
  tags?: GhostTagsSettings[];

  @IsBoolean()
  @IsOptional()
  publish?: boolean;
}
