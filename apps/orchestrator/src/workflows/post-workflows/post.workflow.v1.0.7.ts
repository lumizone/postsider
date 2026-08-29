/**
 * Publish workflow v1.0.7 — no OAuth tokens in Temporal history.
 *
 * Up to v1.0.6 the workflow held the whole `Integration` row (loaded by
 * `getPost`) and passed it into every publishing activity. Everything a
 * workflow receives or passes is persisted in Temporal's event history, so
 * each publish left a plaintext copy of the channel's access token in
 * Temporal's own Postgres — a second copy of the very secret the application
 * database now encrypts at rest.
 *
 * This version passes integration IDs instead; the `*ById` activities load the
 * row (and thus the token) themselves. Token refresh returns a boolean rather
 * than the new credentials: the refreshed value is persisted by the activity,
 * and the next activity reads it from the database.
 *
 * v1.0.6 is left untouched, as required — running workflows replay against the
 * code they started with, and editing a live version in place is what stalled
 * publishing on 2026-08-24.
 */
import { PostActivity } from '@postsider/orchestrator/activities/post.activity';
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

const {
  getPostsListForPublish,
  getPostForPublish,
  claimPostForPublish,
  inAppNotification,
  changeState,
  updatePost,
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

const poke = defineSignal('poke');

const iterate = Array.from({ length: 5 });

export async function postWorkflowV107({
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
  const {
    postSocialById,
    postCommentById,
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
  // get all the posts and comments to post
  const firstPost = await getPostForPublish(organizationId, postId);

  // in case doesn't exists for some reason, fail it
  if (!firstPost) {
    await changeState(postId, 'ERROR', 'No Post');
    return;
  }

  if (!postNow && firstPost.state !== 'QUEUE') {
    await changeState(firstPost.id, 'ERROR', 'Already posted', [firstPost]);
    return;
  }

  // Emergency Pause gate — atomic with the DB: a paused org parks a QUEUE post
  // to HELD (inside a single transaction with the state read), so this check
  // cannot race a pause landing in the same millisecond. Runs regardless of
  // `postNow` (repeat-post children skip the QUEUE check above but must also
  // never publish into a paused org).
  const claim = await claimPostForPublish(organizationId, postId);
  if (claim.outcome === 'held') {
    // Post already flipped to HELD inside the transaction — nothing more to do.
    return;
  }
  if (claim.outcome === 'abort') {
    // Paused but post not QUEUE (e.g. repeat-post of an already-published
    // post) — simply don't publish, don't touch state.
    return;
  }

  // if it's a repeatable post, we should ignore this.
  if (!postNow) {
    await sleep(
      dayjs(firstPost.publishDate).isBefore(dayjs())
        ? 0
        : dayjs(firstPost.publishDate).diff(dayjs(), 'millisecond')
    );
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

    await changeState(
      postsListBefore[0].id,
      'ERROR',
      'Refresh channel needed',
      postsListBefore
    );
    return;
  }

  // Channel was deleted while this post sat in QUEUE — never publish to it.
  // `deleteChannel` only soft-deletes the Integration (deletedAt) and leaves
  // the token intact, and the post-deletion sweep that accompanies it is
  // best-effort, so a surviving QUEUE post would otherwise sail past the
  // refreshNeeded/disabled guards below and publish to an account the user
  // already disconnected. Fail closed here instead.
  if (post.integration?.deletedAt) {
    await changeState(
      postsListBefore[0].id,
      'ERROR',
      'Channel deleted',
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

    await changeState(
      postsListBefore[0].id,
      'ERROR',
      'Channel disabled',
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

  // list of all the saved results
  const postsResults: PostResponse[] = [];

  // iterate over the posts
  for (let i = 0; i < postsList.length; i++) {
    const before = postsResults.length;
    // remembered so the retry-exhaustion path below can record WHY it gave up
    let lastError: unknown = null;
    let localUpdateSucceeded = false;
    // this is a small trick to repeat an action in case of token refresh
    for (const _ of iterate) {
      try {
        // first post the main post
        if (i === 0) {
          // If the provider call succeeded but the local update failed, the
          // retry must reconcile the known provider result instead of
          // publishing the same content again.
          if (postsResults.length <= before) {
            postsResults.push(
              ...(await postSocialById(organizationId, post.integration.id, [
                postsList[i],
              ]))
            );
          }

          // then post the comments if any
        } else {
          if (postsList[i].delay) {
            await sleep(60000 * Math.max(0, Number(postsList[i].delay ?? 0)));
          }

          if (postsResults.length <= before) {
            postsResults.push(
              ...(await postCommentById(
                organizationId,
                post.integration.id,
                postsResults[0].postId,
                postsResults.length === 1
                  ? undefined
                  : postsResults[i - 1].postId,
                [postsList[i]]
              ))
            );
          }
        }

        // mark post as successful
        await updatePost(
          postsList[i].id,
          postsResults[i].postId,
          postsResults[i].releaseURL
        );
        localUpdateSucceeded = true;

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
              if (await isCommentableById(organizationId, post.integration.id)) {
                await postCommentById(
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

        // break the current while to move to the next post
        break;
      } catch (err) {
        lastError = err;
        // if token refresh is needed, do it and repeat
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
            if (i !== 0) {
              await inAppNotification(
                post.organizationId,
                'Thread publishing incomplete',
                'The main post was published, but a follow-up could not be published.'
              );
              return false;
            }
            await changeState(postsList[0].id, 'ERROR', err, postsList);
            return false;
          }

          // No token assignment here: the refreshed credentials were written
          // to the database by the activity, and the retry's postSocialById
          // reads them from there.
          continue;
        }

        // A thread/first-comment failure must not erase the successful main
        // publication. The main post is already PUBLISHED at this point.
        if (i === 0 && postsResults.length === before) {
          await changeState(postsList[0].id, 'ERROR', err, postsList);
        }

        // specific case for bad body errors
        if (
          err instanceof ActivityFailure &&
          err.cause instanceof ApplicationFailure &&
          err.cause.type === 'bad_body'
        ) {
          await inAppNotification(
            post.organizationId,
            `Error posting${i === 0 ? ' ' : ' comments '}on ${
              post.integration?.providerIdentifier
            } for ${post?.integration?.name}`,
            `An error occurred while posting${i === 0 ? ' ' : ' comments '}on ${
              post.integration?.providerIdentifier
            }${err?.cause?.message ? `: ${err?.cause?.message}` : ``}`,
            true,
            false,
            'fail'
          );
          return false;
        }
      }
    }

    if (!localUpdateSucceeded) {
      // All retries exhausted without success. The refresh_token branch above
      // `continue`s past the generic changeState, so this path used to return
      // with the post still QUEUE and `error` null — a "Completed" workflow
      // hiding a dead publish (the silent-outage diagnostic signature, but
      // with healthy workers). Always record the failure before giving up.
      if (i === 0) {
        await changeState(
          postsList[0].id,
          'ERROR',
          lastError ?? 'Publish failed: all retries exhausted',
          postsList
        );
      } else {
        await inAppNotification(
          post.organizationId,
          `Comment publishing failed on ${post.integration?.providerIdentifier}`,
          `The main post was published, but a comment or thread could not be published: ${
            lastError instanceof Error ? lastError.message : 'all retries exhausted'
          }`,
          true,
          false,
          'fail'
        );
      }
      return false;
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
  ).reduce(
    (all, current) => {
      for (let i = 1; i <= current.totalRuns; i++) {
        all.push({
          ...current,
          delay: current.delay * i,
        });
      }

      return all;
    },
    [] as any[]
  );

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
      await startChild(postWorkflowV107, {
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
