import {
  IsArray,
  IsDefined,
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class GmailDto {
  @IsString()
  @MinLength(1)
  @IsDefined()
  subject: string;

  @IsArray()
  @IsEmail({}, { each: true })
  to: string[];

  @IsArray()
  @IsOptional()
  @IsEmail({}, { each: true })
  cc?: string[];

  @IsArray()
  @IsOptional()
  @IsEmail({}, { each: true })
  bcc?: string[];
}
