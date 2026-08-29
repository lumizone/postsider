import {
  IsDefined,
  IsString,
  IsUrl,
  ValidateIf,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ValidUrlExtension, ValidUrlPath } from '@postsider/helpers/utils/valid.url.path';
import { isSafePublicHttpsUrl } from '@postsider/nestjs-libraries/dtos/webhooks/webhook.url.validator';

// Media paths are attacker-controllable through the public API and are later
// fetched by providers (e.g. Mastodon's media upload). Storage-relative paths
// (image/abc.png) never leave the app, but an absolute URL supplied by the
// caller would be fetched server-side — reject any that the SSRF guard refuses.
@ValidatorConstraint({ name: 'checkSafeMediaPath', async: true })
export class SafeMediaPathConstraint implements ValidatorConstraintInterface {
  async validate(value: unknown): Promise<boolean> {
    if (typeof value !== 'string' || !value.trim()) {
      return false;
    }

    if (!/^https?:\/\//i.test(value)) {
      return true;
    }

    return isSafePublicHttpsUrl(value);
  }

  defaultMessage(): string {
    return 'Media URL must be public HTTPS and must not resolve to localhost, private, loopback, or link-local addresses';
  }
}

export class MediaDto {
  @IsString()
  @IsDefined()
  id: string;

  @IsString()
  @IsDefined()
  @Validate(ValidUrlPath)
  @Validate(ValidUrlExtension)
  @Validate(SafeMediaPathConstraint)
  path: string;

  @ValidateIf((o) => o.alt)
  @IsString()
  alt?: string;

  @ValidateIf((o) => o.thumbnail)
  @IsUrl()
  thumbnail?: string;
}
