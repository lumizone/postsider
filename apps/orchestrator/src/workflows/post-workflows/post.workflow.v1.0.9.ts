/**
 * Publish workflow v1.0.9 - at-most-once provider calls.
 *
 * v1.0.8 relied on Temporal activity retries (3 attempts) plus a local loop
 * around the provider call, so a timeout or a lost response could publish the
 * same post twice. v1.0.9 runs the provider-calling activities exactly once
 * (maximumAttempts: 1); they never throw and return classified failures as
 * values. Only safe retries remain: a bounded token refresh for expired auth
 * and bounded delayed retries for rate limits and pre-connection errors. The
 * releaseId guard lives in the activity. Anything else (including Temporal
 * timeouts) is recorded as a failure and never re-run.
 *
 * v1.0.8 and older stay untouched - running workflows replay against the code
 * they started with.
 */
import type {
  PostActivity,
  PublishAttemptResult,
} from '@postsider/orchestrator/activities/post.activity';
import {
  classifyPublishError,
  AUTO_RETRY_DELAYS,
  MAX_AUTH_REFRESHES,
  PublishFailure,
} from '@postsider/nestjs-libraries/integrations/publish-error.classifier';
import {
  ActivityFailure,
  ApplicationFailure,
  startChild,
  proxyActivities,
  sleep,
  defineSignal,
  setHandler,
} from '@temporalio/workflow';
import dayjs from 'dayjs';
import { capitalize, sortBy } from 'lodash';
import { PostResponse } from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { TypedSearchAttributes } from '@temporalio/common';
import { postId as postIdSearchParam } from '@postsider/nestjs-libraries/temporal/temporal.search.attribute';

const proxyTaskQueue = (taskQueue: string) => {
  return proxyActivities<PostActivity>({
    startToCloseTimeout: '10 minute',
    taskQueue,
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 1,
      initialInterval: '2 minutes',
    },
  });
};

// Provider-calling activities run exactly once: Temporal must never re-run a call
// that may already have published. Failures come back as values, not exceptions.
const proxyOnce = (taskQueue: string) =>
  proxyActivities<PostActivity>({
    startToCloseTimeout: '10 minute',
    taskQueue,
    retry: { maximumAttempts: 1 },
  });

const {
  getPostsListForPublish,
  getPostForPublish,
  claimPostForPublish,
  inAppNotification,
  changeState,
  sendWebhooks,
  isCommentableById,
} = proxyActivities<PostActivity>({
  startToCloseTimeout: '10 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

// Writes that record the outcome of (or the refusal to make) a provider call.
// They must not give up: if they did, the row would stay QUEUE with no releaseId
// and the hourly missing-post sweep would publish the post again.
const { markPublishFailed, updatePost } = proxyActivities<PostActivity>({
  startToCloseTimeout: '5 minute',
  retry: {
    maximumAttempts: 0, // unlimited
    initialInterval: '30 seconds',
    backoffCoefficient: 2,
    maximumInterval: '10 minutes',
  },
});

const poke = defineSignal('poke');

const iterate = Array.from({ length: 5 });

export async function postWorkflowV109({
  taskQueue,
  postId,
  organizationId,
  postNow = false,
}: {
  taskQueue: string;
  postId: string;
  organizationId: string;
  postNow?: boolean;
}) {
  // Dynamic task queue, for concurrency
  const { publishPostById, publishCommentById } = proxyOnce(taskQueue);
  const {
    refreshTokenWithCauseById,
    internalPlugsById,
    globalPlugsById,
    processInternalPlug,
    processPlug,
  } = proxyTaskQueue(taskQueue);

  let poked = false;
  setHandler(poke, () => {
    poked = true;
  });

  const startTime = new Date();

  // Load once purely to compute how long to sleep. The authoritative state
  // check happens AGAIN at fire time below, after the sleep.
  const preFlight = await getPostForPublish(organizationId, postId);
  if (!preFlight) {
    await changeState(postId, 'ERROR', 'No Post');
    return;
  }

  if (!postNow) {
    await sleep(
      dayjs(preFlight.publishDate).isBefore(dayjs())
        ? 0
        : dayjs(preFlight.publishDate).diff(dayjs(), 'millisecond')
    );
  }

  // ── FIRE TIME ───────────────────────────────────────────────────────────
  // Re-load and re-validate NOW. A post that was edited back to DRAFT/HELD
  // (or published by a replacement workflow) while this workflow slept must
  // not fire. The pause gate below is atomic with the DB.
  const firstPost = await getPostForPublish(organizationId, postId);
  if (!firstPost) {
    await changeState(postId, 'ERROR', 'No Post');
    return;
  }

  if (!postNow && firstPost.state !== 'QUEUE') {
    // Deliberate user action (unscheduled draft, held by pause, or already
    // published by a replacement workflow) - stop silently, not an error.
    return;
  }

  // Emergency Pause gate - atomic with the DB: a paused org parks a QUEUE post
  // to HELD (inside a single transaction with the state read), so this check
  // cannot race a pause landing in the same millisecond. Runs regardless of
  // `postNow` (repeat-post children skip the QUEUE check above but must also
  // never publish into a paused org).
  const claim = await claimPostForPublish(organizationId, postId);
  if (claim.outcome === 'held') {
    // Post already flipped to HELD inside the transaction - nothing more to do.
    return;
  }
  if (claim.outcome === 'abort') {
    // Paused but post not QUEUE (e.g. repeat-post of an already-published
    // post) - simply don't publish, don't touch state.
    return;
  }

  const postsListBefore = await getPostsListForPublish(organizationId, postId);
  const [post] = postsListBefore;

  if (!post) {
    await changeState(postId, 'ERROR', 'No Post');
    return;
  }

  // if refresh is needed from last time, let's inform the user
  if (post.integration?.refreshNeeded) {
    await inAppNotification(
      post.organizationId,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name}`,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name} because you need to reconnect it. Please enable it and try again.`,
      true,
      false,
      'info',
      undefined,
      {
        key: 'postFailedReconnect',
        params: {
          channel: post?.integration?.name ?? '',
          provider: post.integration?.providerIdentifier ?? '',
        },
      }
    );

    await markPublishFailed(
      post.organizationId,
      postsListBefore[0].id,
      {
        category: 'AUTH_EXPIRED',
        retryable: false,
        autoRetry: 'none',
        message: 'Refresh channel needed',
      },
      postsListBefore
    );
    return;
  }

  // Channel was deleted while this post sat in QUEUE - never publish to it.
  // `deleteChannel` only soft-deletes the Integration (deletedAt) and leaves
  // the token intact, and the post-deletion sweep that accompanies it is
  // best-effort, so a surviving QUEUE post would otherwise sail past the
  // refreshNeeded/disabled guards below and publish to an account the user
  // already disconnected. Fail closed here instead.
  if (post.integration?.deletedAt) {
    await markPublishFailed(
      post.organizationId,
      postsListBefore[0].id,
      {
        category: 'UNKNOWN',
        retryable: false,
        autoRetry: 'none',
        message: 'Channel deleted',
      },
      postsListBefore
    );
    return;
  }

  // if it's disabled, inform the user
  if (post.integration?.disabled) {
    await inAppNotification(
      post.organizationId,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name}`,
      `We couldn't post to ${post.integration?.providerIdentifier} for ${post?.integration?.name} because it's disabled. Please enable it and try again.`,
      true,
      false,
      'info',
      undefined,
      {
        key: 'postFailedDisabled',
        params: {
          channel: post?.integration?.name ?? '',
          provider: post.integration?.providerIdentifier ?? '',
        },
      }
    );

    await markPublishFailed(
      post.organizationId,
      postsListBefore[0].id,
      {
        category: 'UNKNOWN',
        retryable: false,
        autoRetry: 'none',
        message: 'Channel disabled',
      },
      postsListBefore
    );
    return;
  }

  // Do we need to post comment for this social?
  const toComment: boolean =
    postsListBefore.length === 1
      ? false
      : await isCommentableById(organizationId, post.integration.id);

  const postsList = toComment ? postsListBefore : [postsListBefore[0]];

  const postsResults: PostResponse[] = [];
  for (let i = 0; i < postsList.length; i++) {
    if (i > 0 && postsList[i].delay) {
      await sleep(60000 * Math.max(0, Number(postsList[i].delay ?? 0)));
    }
    let refreshes = 0;
    let delays = 0;
    let outcome!: PublishAttemptResult;
    for (;;) {
      try {
        outcome =
          i === 0
            ? await publishPostById(
                organizationId,
                post.integration.id,
                [postsList[i]],
                postNow
              )
            : await publishCommentById(
                organizationId,
                post.integration.id,
                postsResults[0].postId,
                postsResults.length === 1
                  ? undefined
                  : postsResults[i - 1].postId,
                [postsList[i]]
              );
      } catch (err) {
        // Includes Temporal timeouts: the call may have published, never retry it.
        outcome = { outcome: 'failed', failure: classifyPublishError(err) };
      }
      if (outcome.outcome !== 'failed') break;
      const failure: PublishFailure = outcome.failure;
      if (failure.autoRetry === 'refresh' && refreshes < MAX_AUTH_REFRESHES) {
        refreshes++;
        if (
          await refreshTokenWithCauseById(
            organizationId,
            post.integration.id,
            failure.message
          )
        ) {
          continue;
        }
        outcome = {
          outcome: 'failed',
          failure: { ...failure, retryable: false, autoRetry: 'none' },
        };
        break;
      }
      if (failure.autoRetry === 'delay' && delays < AUTO_RETRY_DELAYS.length) {
        await sleep(AUTO_RETRY_DELAYS[delays++]);
        continue;
      }
      break;
    }

    if (outcome.outcome === 'already_published') {
      return; // at-most-once: the row already carries a release id
    }
    if (outcome.outcome === 'failed') {
      if (i === 0) {
        await markPublishFailed(
          post.organizationId,
          postsList[0].id,
          outcome.failure,
          postsList
        );
      }
      await inAppNotification(
        post.organizationId,
        i === 0
          ? `Error posting on ${post.integration?.providerIdentifier} for ${post?.integration?.name}`
          : `Comment publishing failed on ${post.integration?.providerIdentifier}`,
        i === 0
          ? `An error occurred while posting on ${post.integration?.providerIdentifier}: ${outcome.failure.message}`
          : `The main post was published, but a comment or thread could not be published: ${outcome.failure.message}`,
        true,
        false,
        'fail'
      );
      return false;
    }

    postsResults.push(...outcome.results);
    try {
      await updatePost(
        postsList[i].id,
        postsResults[i].postId,
        postsResults[i].releaseURL
      );
    } catch (updateErr) {
      // Published on the platform, result not saved: never call the provider again.
      await markPublishFailed(
        post.organizationId,
        postsList[i].id,
        {
          category: 'UNKNOWN_OUTCOME',
          retryable: false,
          autoRetry: 'none',
          message: `Published on the platform (${postsResults[i].releaseURL}) but PostSider could not save the result. Do not retry. Check the channel.`,
        },
        postsList
      );
      return false;
    }

    if (i === 0) {
      // Notification is secondary. Keep it outside the publish failure
      // path so a mail/digest outage cannot rewrite PUBLISHED to ERROR.
      try {
        await inAppNotification(
          post.integration.organizationId,
          `Your post has been published on ${capitalize(
            post.integration.providerIdentifier
          )}`,
          `Your post has been published on ${capitalize(
            post.integration.providerIdentifier
          )} at ${postsResults[0].releaseURL}`,
          true,
          true,
          'success',
          postsResults[0].releaseURL,
          {
            key: 'postPublished',
            params: {
              channel: post.integration.name ?? '',
              provider: capitalize(post.integration.providerIdentifier),
            },
          }
        );
      } catch (notificationError) {
        // The post is already durable and published. Notification retry
        // must not trigger the provider publish retry path.
      }

      // best-effort: publish the post's first comment (if any) as a comment.
      // Mirrors the thread postComment invocation above. Never fails the main publish.
      const firstComment = (post as any).firstComment as
        | string
        | null
        | undefined;
      if (firstComment && firstComment.trim().length > 0) {
        try {
          if (
            await isCommentableById(organizationId, post.integration.id)
          ) {
            await publishCommentById(
              organizationId,
              post.integration.id,
              postsResults[0].postId,
              undefined,
              [
                {
                  id: `${postsList[0].id}_first_comment`,
                  content: firstComment,
                  settings: '{}',
                  image: '[]',
                } as any,
              ]
            );
          }
        } catch (firstCommentErr) {
          // swallow: first comment is best-effort and must not fail the publish
        }
      }
    }
  }

  // send webhooks for the post
  await sendWebhooks(
    postsResults[0].postId,
    post.organizationId,
    post.integration.id
  );

  // load internal plugs like repost by other users
  const internalPlugsList = await internalPlugsById(
    organizationId,
    post.integration.id,
    JSON.parse(post.settings)
  );

  // load global plugs, like repost a post if it gets to a certain number of likes
  const globalPlugsList = (
    await globalPlugsById(organizationId, post.integration.id)
  ).reduce((all, current) => {
    for (let i = 1; i <= current.totalRuns; i++) {
      all.push({
        ...current,
        delay: current.delay * i,
      });
    }

    return all;
  }, [] as any[]);

  // Check if the post is repeatable
  const repeatPost = !post.intervalInDays
    ? []
    : [
        {
          type: 'repeat-post',
          delay:
            post.intervalInDays * 24 * 60 * 60 * 1000 -
            (new Date().getTime() - startTime.getTime()),
        },
      ];

  // Sort all the actions by delay, so we can process them in order
  const list: any[] = sortBy(
    [...internalPlugsList, ...globalPlugsList, ...repeatPost],
    'delay'
  );

  // process all the plugs in order, we are using while because in some cases we need to remove items from the list
  while (list.length > 0) {
    // get the next to process
    const todo = list.shift();

    // wait for the delay
    await sleep(Math.max(0, Number(todo.delay ?? 0)));

    // process internal plug
    if (todo.type === 'internal-plug') {
      for (const _ of iterate) {
        try {
          await processInternalPlug({ ...todo, post: postsResults[0].postId });
        } catch (err) {
          if (
            err instanceof ActivityFailure &&
            err.cause instanceof ApplicationFailure &&
            err.cause.type === 'refresh_token'
          ) {
            const refresh = await refreshTokenWithCauseById(
              organizationId,
              todo.integration,
              err?.cause?.message || ''
            );
            if (!refresh) {
              break;
            }

            continue;
          }

          if (
            err instanceof ActivityFailure &&
            err.cause instanceof ApplicationFailure &&
            err.cause.type === 'bad_body'
          ) {
            break;
          }

          continue;
        }
        break;
      }
    }

    // process global plug
    if (todo.type === 'global') {
      for (const _ of iterate) {
        try {
          const process = await processPlug({
            ...todo,
            postId: postsResults[0].postId,
          });
          if (process) {
            const toDelete = list
              .reduce((all, current, index) => {
                if (current.plugId === todo.plugId) {
                  all.push(index);
                }

                return all;
              }, [] as number[])
              .reverse();

            for (const index of toDelete) {
              list.splice(index, 1);
            }
          }
        } catch (err) {
          if (
            err instanceof ActivityFailure &&
            err.cause instanceof ApplicationFailure &&
            err.cause.type === 'refresh_token'
          ) {
            const refresh = await refreshTokenWithCauseById(
              organizationId,
              post.integration.id,
              err?.cause?.message || ''
            );
            if (!refresh) {
              break;
            }

            continue;
          }

          if (
            err instanceof ActivityFailure &&
            err.cause instanceof ApplicationFailure &&
            err.cause.type === 'bad_body'
          ) {
            break;
          }

          continue;
        }

        break;
      }
    }

    // process repeat post in a new workflow, this is important so the other plugs can keep running
    if (todo.type === 'repeat-post') {
      await startChild(postWorkflowV109, {
        parentClosePolicy: 'ABANDON',
        args: [
          {
            taskQueue,
            postId,
            organizationId,
            postNow: true,
          },
        ],
        workflowId: `post_${post.id}_${makeId(10)}`,
        typedSearchAttributes: new TypedSearchAttributes([
          {
            key: postIdSearchParam,
            value: postId,
          },
        ]),
      });
    }
  }
}
