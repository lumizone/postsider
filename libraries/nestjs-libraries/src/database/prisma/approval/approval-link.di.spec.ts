jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));
import { Test } from '@nestjs/testing';
import { ApprovalService } from './approval.service';
import { ApprovalLinkService } from './approval-link.service';
import { ApprovalLinkRepository } from './approval-link.repository';
import { ApprovalRepository } from './approval.repository';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { NotificationService } from '@postsider/nestjs-libraries/database/prisma/notifications/notification.service';
import { OrganizationRepository } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.repository';
import { PublicWebhookDeliveryService } from '@postsider/nestjs-libraries/database/prisma/webhooks/public-webhook-delivery.service';
it('ApprovalService and ApprovalLinkService resolve their circular dependency', async () => {
  const m = await Test.createTestingModule({
    providers: [ApprovalService, ApprovalLinkService,
      { provide: ApprovalLinkRepository, useValue: {} },
      { provide: ApprovalRepository, useValue: {} },
      { provide: PostsService, useValue: {} },
      { provide: NotificationService, useValue: {} },
      { provide: OrganizationRepository, useValue: {} },
      { provide: PublicWebhookDeliveryService, useValue: {} }],
  }).compile();
  const a = m.get(ApprovalService) as any, l = m.get(ApprovalLinkService) as any;
  expect(a._links).toBe(l);
  expect(l._approvals).toBe(a);
});
