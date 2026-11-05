import { HttpException, HttpStatus } from '@nestjs/common';
import { Organization } from '@prisma/client';

/** ADMIN or above. API keys act as SUPERADMIN; OAuth tokens carry the member's real role. */
export function assertAdmin(org: Organization) {
  const role = (org as any).users?.[0]?.role;
  if (role !== 'ADMIN' && role !== 'SUPERADMIN') {
    throw new HttpException(
      { msg: 'This action needs an ADMIN or owner role.' },
      HttpStatus.FORBIDDEN
    );
  }
}
