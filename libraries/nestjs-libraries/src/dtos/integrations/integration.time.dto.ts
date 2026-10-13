import {
  IsArray,
  IsDefined,
  IsInt,
  IsNumber,
  Max,
  Min,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class IntegrationValidateTimeDto {
  @IsDefined()
  @IsNumber()
  time: number;

  /**
   * Weekdays this slot applies to (0 = Sunday .. 6 = Saturday). Absent or
   * empty means every day. Declared so it is validated; it was already being
   * stored when sent.
   */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days?: number[];
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
