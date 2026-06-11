import { IsDefined, IsOptional, IsString, MinLength } from 'class-validator';

export class NotionDto {
  /**
   * Title of the new page (Notion requires a title for Database items).
   */
  @IsString()
  @MinLength(1)
  @IsDefined()
  title: string;

  /**
   * Notion Database ID where the page will be created.
   */
  @IsString()
  @IsDefined()
  database: string;

  /**
   * Optional name of the title property on the database. Defaults to "Name".
   */
  @IsString()
  @IsOptional()
  titleProperty?: string;
}
