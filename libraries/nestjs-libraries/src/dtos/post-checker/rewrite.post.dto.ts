import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class RewritePostDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  content: string;

  @IsOptional()
  @IsIn(['rephrase', 'shorten', 'formal', 'casual', 'punchy'])
  tone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  count?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  platform?: string;
}
