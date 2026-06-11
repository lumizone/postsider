import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class BearBlogTagsSettings {
  @IsString()
  value: string;

  @IsString()
  label: string;
}

export class BearBlogDto {
  @IsString()
  @MinLength(1)
  @IsDefined()
  title: string;

  @IsString()
  @IsOptional()
  slug?: string;

  @IsArray()
  @IsOptional()
  tags?: BearBlogTagsSettings[];

  /**
   * Whether the post should be public (true) or saved as a draft (false).
   * Defaults to true.
   */
  @IsBoolean()
  @IsOptional()
  publish?: boolean;
}
