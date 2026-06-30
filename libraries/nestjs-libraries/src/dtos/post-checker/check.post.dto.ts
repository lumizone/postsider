import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ArrayNotEmpty,
} from 'class-validator';

export class CheckPostDto {
  @IsString()
  @MaxLength(10000)
  content: string;

  @IsBoolean()
  hasMedia: boolean;

  @IsOptional()
  @IsIn(['image', 'video', 'mixed'])
  mediaType?: 'image' | 'video' | 'mixed';

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  platforms: string[];
}
