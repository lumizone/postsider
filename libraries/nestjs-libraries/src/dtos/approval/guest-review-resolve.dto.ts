import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';

// Rollout switch: the guest page must send the identity fields before the
// backend requires them. Read at validation time so it can be flipped by env.
const identityRequired = () =>
  process.env.GUEST_REVIEW_REQUIRE_IDENTITY !== 'false';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class GuestReviewResolveDto {
  @IsIn(['approve', 'reject'])
  action: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ValidateIf((o) => identityRequired() || o.guestName !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  guestName?: string;

  @ValidateIf((o) => identityRequired() || o.guestEmail !== undefined)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value
  )
  @IsEmail()
  @MaxLength(254)
  guestEmail?: string;
}
