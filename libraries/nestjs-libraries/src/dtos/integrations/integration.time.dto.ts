import {
  IsArray,
  IsDefined,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class IntegrationValidateTimeDto {
  @IsDefined()
  @IsNumber()
  time: number;
}
export class IntegrationTimeDto {
  @Type(() => IntegrationValidateTimeDto)
  @IsArray()
  @IsDefined()
  @ValidateNested({ each: true })
  time: IntegrationValidateTimeDto[];

  /** IANA name (e.g. "America/New_York"). `time[].time` is local to this zone. */
  @IsOptional()
  @IsString()
  timezone?: string;
}
