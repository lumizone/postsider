import { MediaDto } from '@postsider/nestjs-libraries/dtos/media/media.dto';
import {
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class UserDetailDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  fullname: string;

  @IsString()
  @IsOptional()
  name: string;

  @IsString()
  @IsOptional()
  lastName: string;

  @IsNumber()
  @IsOptional()
  timezone: number;

  @IsString()
  @IsOptional()
  bio: string;

  @IsOptional()
  @ValidateNested()
  picture: MediaDto;
}
