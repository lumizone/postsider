import { Body, Controller, Get, HttpException, Post, Put } from '@nestjs/common';
import { User } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { GetUserFromRequest } from '@postsider/nestjs-libraries/user/user.from.request';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { AuditLogger } from '@postsider/nestjs-libraries/database/prisma/audit/audit.logger';
import { MfaService } from '@postsider/backend/services/auth/mfa.service';

@ApiTags('User security')
@Controller('/user/mfa')
export class MfaController {
  constructor(private readonly mfa: MfaService, private readonly audit: AuditLogger) {}

  @Get('/policy')
  async policy(@GetUserFromRequest() user: User) {
    this.assertPlatformSuperAdmin(user);
    return this.mfa.getPolicy();
  }

  @Put('/policy')
  async updatePolicy(@GetOrgFromRequest() org: Organization, @GetUserFromRequest() user: User, @Body('enforceForAll') enforceForAll: unknown) {
    this.assertPlatformSuperAdmin(user);
    if (typeof enforceForAll !== 'boolean') {
      throw new HttpException('enforceForAll must be a boolean', 400);
    }
    const policy = await this.mfa.updatePolicy(enforceForAll);
    await this.audit.logSecurityEvent(org.id, 'mfa.policy_updated', user.id, { enforceForAll });
    return policy;
  }

  @Get('/status')
  status(@GetUserFromRequest() user: User) {
    return this.mfa.status(user.id);
  }

  @Post('/begin')
  async begin(@GetUserFromRequest() user: User) {
    const enrollment = await this.mfa.beginEnrollment(user.id, user.email);
    await this.audit.logAuthEvent('auth.mfa_setup_started', { userId: user.id });
    return enrollment;
  }

  @Post('/confirm')
  async confirm(@GetUserFromRequest() user: User, @Body('code') code: string) {
    const result = await this.mfa.confirmEnrollment(user.id, code);
    await this.audit.logAuthEvent('auth.mfa_enabled', { userId: user.id });
    return result;
  }

  private assertPlatformSuperAdmin(user: User) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Only a platform superadmin can manage MFA policy', 403);
    }
  }

  @Post('/disable')
  async disable(@GetUserFromRequest() user: User, @Body('code') code: string) {
    await this.mfa.disable(user.id, code);
    await this.audit.logAuthEvent('auth.mfa_disabled', { userId: user.id });
    return { disabled: true };
  }
}
