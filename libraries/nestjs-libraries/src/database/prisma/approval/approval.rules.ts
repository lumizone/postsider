import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

// Pure approval guards. Kept free of service/DB imports so they can be
// unit-tested with the standalone ts-jest config (no path-alias resolution).

export function assertRequestable(
  post: { state: string; parentPostId: string | null } | null | undefined
): void {
  if (!post) throw new NotFoundException('Post not found');
  if (post.parentPostId) {
    throw new BadRequestException('Only the main post can be sent for approval');
  }
  if (post.state !== 'DRAFT' && post.state !== 'APPROVAL') {
    throw new BadRequestException('Only draft posts can be sent for approval');
  }
}

export function assertCanApprove(role: string): void {
  if (role !== 'ADMIN' && role !== 'SUPERADMIN') {
    throw new ForbiddenException('Only admins can approve or reject posts');
  }
}

export function assertPending(
  approval: { status: string } | null | undefined
): void {
  if (!approval) throw new NotFoundException('Approval not found');
  if (approval.status !== 'PENDING') {
    throw new BadRequestException('This approval has already been resolved');
  }
}
