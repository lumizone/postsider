import {
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ArrayNotEmpty,
} from 'class-validator';

export class CheckPostDto {
  @IsString()
  @MaxLength(4000)
  content: string;

  @IsBoolean()
  hasMedia: boolean;

  @IsOptional()
  @IsIn(['image', 'video', 'mixed'])
  mediaType?: 'image' | 'video' | 'mixed';

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsString({ each: true })
  platforms: string[];
}
