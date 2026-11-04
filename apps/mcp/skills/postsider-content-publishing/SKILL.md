---
name: postsider-content-publishing
description: Create a PostSider draft, schedule a post, or publish a post now after resolving the target channel and validating the requested content. Use when the user asks to draft, schedule, queue, or publish social content.
---

# Create, schedule, or publish PostSider content

Use this skill for one intentional publishing action. The user's explicit instructions take precedence over workflow defaults. Do not add a separate approval round when the user already supplied or approved the exact content, target channel, and timing.

## Required inputs

Before a write, establish:
- exact post content;
- target channel or channels;
- action: draft, schedule, or publish now;
- publish time and timezone for a scheduled post;
- media, if required by the selected platform.

Ask only for a missing detail that changes the action. Never invent ids, dates, content, media paths, or platform settings.

## Workflow

1. Call `postsider_list_channels` and resolve each requested channel to a fresh id.
2. For scheduling, call `postsider_get_publishing_state`. If publishing is paused, stop and explain that new scheduled posts are rejected while paused.
3. Before posting to a channel for the first time, call `postsider_get_channel_rules` for its length limit and required `settings` instead of guessing.
4. Review the relevant date range with `postsider_list_posts` when the user asks to avoid calendar conflicts. Use `postsider_find_slot` only when the user asks for the queue's next free time or accepts queue-based timing.
5. If media must be stored first, upload it once and use the returned media object: `postsider_upload_media_from_url` for a public HTTPS URL, `postsider_upload_media_base64` for bytes you hold (max 25 MB), `postsider_upload_media_from_file` for a path on the user's machine (local server only), or reuse a file from `postsider_list_media`. To reuse a post on another channel, call `postsider_duplicate_post` (it creates a draft) and then adjust the copy. Use `postsider_get_content_library` for the team's hashtag groups and caption templates, and `postsider_check_post` / `postsider_rewrite_post` when the user asks for an AI review or alternatives (they use the monthly AI allowance, so do not run them unasked). To change an existing post (for example to attach media), use `postsider_update_post` rather than deleting and recreating it. Do not request credentials or authentication secrets as tool inputs.
6. Call `postsider_create_post` with the action the user requested:
   - `draft` for a draft;
   - `schedule` for a future time;
   - `now` only when the user explicitly asks to publish immediately.
7. Call `postsider_get_post` with the returned id. Verify the stored content, target channel, state, publish time, and media before reporting success.
8. If the write fails, report a concise actionable error without exposing credentials, tokens, debug payloads, or internal telemetry. Do not retry a write blindly. A post that failed to publish (`ERROR`) can be fixed with `postsider_update_post` and then re-queued with `postsider_update_post_status` (`schedule`); do not delete and recreate it. If the post's `errorCategory` is `UNKNOWN_OUTCOME`, it may already be live: ask the user to check the channel and confirm before re-queuing it. To retry every failed post of a group at once, prefer `postsider_retry_failed_posts`; posts whose error category is `UNKNOWN_OUTCOME` may already be live on the provider, so they are skipped unless the user confirms and you pass `includeUnknownOutcome: true`.

## Policy outcomes

The workspace may have policies. Before you schedule or publish, call `postsider_check_policy` with the same `type`, `date` and `posts`; it writes nothing. Then act on the effect:
- `ALLOW`: proceed with `postsider_create_post`.
- `REQUIRE_APPROVAL`: tell the user the post will wait for a human. After creating it, the response has `approvalRequested: true` and the post is NOT scheduled; poll `postsider_get_approval_status` and do not report it as scheduled.
- `BLOCK`: the write fails with `policy_blocked`. Never retry the same content, and never try another channel to dodge the rule. Change the content or ask the owner.

A key with limits can be refused with `key_action_not_allowed` or `key_channel_not_allowed`. Do not look for a workaround: tell the user the owner must change the key limits in Settings, API.

## Consequential actions

- A clear instruction to schedule a specific post at a specific time is authorization to schedule it.
- A clear instruction to publish a specific post now is authorization to publish it now. If "publish" could mean draft or schedule, ask which outcome the user wants.
- Do not turn a request to prepare or suggest copy into a write.
- Do not use `postsider_delete_post` or `postsider_pause_publishing` in this workflow.

## Output

Return the final content, channel, action, state, and local publish time. Include the verified post id. Say plainly what could not be verified.
