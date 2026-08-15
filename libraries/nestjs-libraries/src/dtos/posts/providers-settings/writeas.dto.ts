import { IsDefined, IsIn, IsOptional, IsString } from 'class-validator';

export class WriteAsDto {
  @IsString()
  @IsOptional()
  title?: string;

  /**
   * Optional collection (blog) alias. If omitted the post is created
   * as an anonymous post on the Write.as account.
   */
  @IsString()
  @IsOptional()
  collection?: string;

  @IsString()
  @IsOptional()
  @IsIn([
    'normal',
    'serif',
    'sans',
    'wrap',
    'mono',
    'code',
  ])
  font?: string;

  @IsString()
  @IsOptional()
  language?: string;
}
