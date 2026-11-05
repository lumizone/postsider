import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class EvaluatePolicyImageDto {
  @ApiProperty()
  @IsString()
  path: string;
}

export class EvaluatePolicyValueDto {
  @ApiProperty()
  @IsString()
  content: string;

  @ApiPropertyOptional({ type: [EvaluatePolicyImageDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => EvaluatePolicyImageDto)
  image?: EvaluatePolicyImageDto[];
}

export class EvaluatePolicyIntegrationDto {
  @ApiProperty()
  @IsDefined()
  @IsString()
  id: string;
}

export class EvaluatePolicyPostDto {
  @ApiProperty({ type: EvaluatePolicyIntegrationDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => EvaluatePolicyIntegrationDto)
  integration: EvaluatePolicyIntegrationDto;

  @ApiProperty({ type: [EvaluatePolicyValueDto], description: '1 to 50 thread entries.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => EvaluatePolicyValueDto)
  value: EvaluatePolicyValueDto[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  firstComment?: string | null;
}

/**
 * Body of the policy dry run. It mirrors the fields of the post create body
 * that rules can look at; other keys (settings, shortLink, tags) are accepted
 * and ignored. The controller copies only the fields below.
 */
export class EvaluatePolicyDto {
  @ApiProperty({ enum: ['draft', 'schedule', 'now'] })
  @IsDefined()
  @IsIn(['draft', 'schedule', 'now'])
  type: 'draft' | 'schedule' | 'now';

  @ApiPropertyOptional({ description: 'ISO 8601. Required for schedule.' })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiProperty({ type: [EvaluatePolicyPostDto], description: '1 to 20 posts.' })
  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => EvaluatePolicyPostDto)
  posts: EvaluatePolicyPostDto[];
}
