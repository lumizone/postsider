import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

/** Body of POST /public/approver-links/:token/decision (JSON only). */
export class ApproverLinkDecisionDto {
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** The value returned by the GET of the same link. */
  @IsString()
  @Length(1, 200)
  challenge: string;
}
