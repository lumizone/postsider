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
3. Review the relevant date range with `postsider_list_posts` when the user asks to avoid calendar conflicts. Use `postsider_find_slot` only when the user asks for the queue's next free time or accepts queue-based timing.
4. If media is supplied as a public HTTPS URL and must be stored first, call `postsider_upload_media_from_url` once and use the returned media object. Do not request credentials or authentication secrets as tool inputs.
5. Call `postsider_create_post` with the action the user requested:
   - `draft` for a draft;
   - `schedule` for a future time;
   - `now` only when the user explicitly asks to publish immediately.
6. Call `postsider_get_post` with the returned id. Verify the stored content, target channel, state, publish time, and media before reporting success.
7. If the write fails, report a concise actionable error without exposing credentials, tokens, debug payloads, or internal telemetry. Do not retry a write blindly.

## Consequential actions

- A clear instruction to schedule a specific post at a specific time is authorization to schedule it.
- A clear instruction to publish a specific post now is authorization to publish it now. If "publish" could mean draft or schedule, ask which outcome the user wants.
- Do not turn a request to prepare or suggest copy into a write.
- Do not use `postsider_delete_post` or `postsider_pause_publishing` in this workflow.

## Output

Return the final content, channel, action, state, and local publish time. Include the verified post id. Say plainly what could not be verified.
