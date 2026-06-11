import {
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class RumbleDto {
  @IsString()
  @MinLength(2)
  @IsDefined()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  @IsIn(['public', 'unlisted', 'private'])
  visibility?: 'public' | 'unlisted' | 'private';

  @IsString()
  @IsOptional()
  channel?: string;
}
