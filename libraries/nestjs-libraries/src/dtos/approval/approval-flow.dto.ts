import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { BadRequestException } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const APPROVAL_STAGE_ROLES = ['ADMIN', 'SUPERADMIN'] as const;
export type ApprovalStageRole = (typeof APPROVAL_STAGE_ROLES)[number];

export const MAX_FLOW_STAGES = 5;
export const MAX_STAGE_APPROVERS = 20;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ApprovalFlowStageDto {
  @ApiProperty({ example: 'Legal review', maxLength: 80 })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name: string;

  @ApiProperty({ enum: APPROVAL_STAGE_ROLES })
  @IsIn(APPROVAL_STAGE_ROLES as unknown as string[])
  minRole: ApprovalStageRole;

  @ApiPropertyOptional({
    type: [String],
    description: 'Member user ids allowed to decide this stage. Empty means any member with the minimum role.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_STAGE_APPROVERS)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  approverUserIds?: string[];

  @ApiPropertyOptional({ description: 'Let an API key or OAuth client decide this stage. Defaults to false.' })
  @IsOptional()
  @IsBoolean()
  allowAutomation?: boolean;

  @ApiPropertyOptional({ description: 'Let a guest review link decide this stage. Defaults to false.' })
  @IsOptional()
  @IsBoolean()
  allowGuest?: boolean;
}

export class CreateApprovalFlowDto {
  @ApiProperty({ example: 'Client sign-off', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiPropertyOptional({ description: 'Use this flow when no rule names a flow. Defaults to false.' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: 'The creator or requester cannot decide. Defaults to true.' })
  @IsOptional()
  @IsBoolean()
  preventSelfApproval?: boolean;

  @ApiPropertyOptional({ description: 'One person cannot decide two stages. Defaults to true.' })
  @IsOptional()
  @IsBoolean()
  requireDistinctApprovers?: boolean;

  @ApiProperty({ type: [ApprovalFlowStageDto], description: '1 to 5 stages, decided in array order.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_FLOW_STAGES)
  @ValidateNested({ each: true })
  @Type(() => ApprovalFlowStageDto)
  stages: ApprovalFlowStageDto[];
}

/** Every field optional. A supplied `stages` array replaces the whole list. */
export class UpdateApprovalFlowDto extends PartialType(CreateApprovalFlowDto) {}

const FLOW_FIELDS = ['name', 'isDefault', 'preventSelfApproval', 'requireDistinctApprovers'] as const;
const STAGE_FIELDS = ['name', 'minRole', 'approverUserIds', 'allowAutomation', 'allowGuest'] as const;

const nullField = (key: string) =>
  new BadRequestException({ msg: `${key} must not be null`, field: key });

/**
 * The global ValidationPipe does not whitelist, so unknown body fields
 * (organizationId, id, deletedAt, flowId, position, ...) survive validation.
 * Only these are ever handed to the service. Same pattern as RULE_FIELDS in
 * the policies controllers.
 */
export function pickApprovalFlowFields<T extends Partial<CreateApprovalFlowDto>>(body: T): T {
  const picked: Record<string, unknown> = {};
  for (const key of FLOW_FIELDS) {
    const value = (body as Record<string, unknown>)[key];
    if (value === null) throw nullField(key);
    if (value !== undefined) picked[key] = value;
  }
  const stages = (body as Record<string, unknown>).stages;
  if (stages === null) throw nullField('stages');
  if (stages !== undefined) {
    if (!Array.isArray(stages)) throw nullField('stages');
    picked.stages = stages.map((raw) => {
      if (raw === null || typeof raw !== 'object') throw nullField('stages');
      const stage: Record<string, unknown> = {};
      for (const key of STAGE_FIELDS) {
        const value = (raw as Record<string, unknown>)[key];
        if (value === null) throw nullField(`stages.${key}`);
        if (value !== undefined) stage[key] = value;
      }
      return stage;
    });
  }
  return picked as T;
}
