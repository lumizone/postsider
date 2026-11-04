import { Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalService } from '@postsider/nestjs-libraries/database/prisma/approval/approval.service';
import { PostsRepository } from '@postsider/nestjs-libraries/database/prisma/posts/posts.repository';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';

/**
 * Sends a post that a REQUIRE_APPROVAL rule matched to the approval queue.
 * A post that is already armed (QUEUE) or failed (ERROR) is first moved back
 * to DRAFT, because only a draft can be sent for approval. Errors propagate:
 * the post is then left a DRAFT, never queued (fail closed).
 */
@Injectable()
export class PolicyApprovalRouter {
  constructor(
    private _posts: PostsService,
    private _approvals: ApprovalService,
    private _repo: PostsRepository
  ) {}

  async route(
    orgId: string,
    postId: string,
    opts: { terminateWorkflow: boolean }
  ): Promise<{ requested: boolean; approvalId: string | null }> {
    const post = await this._repo.getPostById(postId, orgId);
    if (!post) throw new NotFoundException({ msg: 'Post not found' });

    if (post.state === 'HELD') {
      // Held posts have no live workflow: only the state moves.
      await this._posts.setPostState(orgId, postId, 'DRAFT');
    } else if (post.state === 'QUEUE' || post.state === 'ERROR') {
      if (opts.terminateWorkflow) {
        // Also stops the armed publish workflow.
        await this._posts.changePostStatus(orgId, postId, 'draft');
      } else {
        // The post was just created without a workflow: only the state moves.
        await this._posts.setPostState(orgId, postId, 'DRAFT');
      }
    }

    const result = await this._approvals.requestApprovalFromApi(orgId, postId);
    return { requested: !!result.created, approvalId: result.id ?? null };
  }
}
