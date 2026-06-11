import { IsBoolean, IsDefined, IsOptional, IsString, MinLength } from 'class-validator';

export class MataroaDto {
  @IsString()
  @MinLength(1)
  @IsDefined()
  title: string;

  /**
   * Whether the post should be published immediately (true) or saved as draft (false).
   * Mataroa generates the slug automatically from the title; it cannot be
   * customised at creation time.
   */
  @IsBoolean()
  @IsOptional()
  published?: boolean;
}
