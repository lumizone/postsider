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

// Even with the switch off, a half-supplied identity is a client bug: both or none.
const identityValidated = (o: GuestReviewResolveDto) =>
  identityRequired() || o.guestName !== undefined || o.guestEmail !== undefined;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class GuestReviewResolveDto {
  @IsIn(['approve', 'reject'])
  action: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ValidateIf(identityValidated)
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  guestName?: string;

  @ValidateIf(identityValidated)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value
  )
  @IsEmail()
  @MaxLength(254)
  guestEmail?: string;
}
