---
name: postsider-agency-operations
description: Review PostSider agency operations across customer groups, notifications, approvals, queued posts, and publishing incidents. Use for morning checks, customer reports, operational triage, or an emergency publishing pause.
---

# Run a PostSider agency operations check

Use this skill for organization-wide operations. The user's explicit instructions take precedence over this workflow.

## Routine review

1. Call `postsider_get_agency_overview` for the requested period.
2. Call `postsider_get_notifications` to identify failures or channels that need attention.
3. Call `postsider_list_groups` before a customer-specific report. Use only a returned customer id with `postsider_get_customer_report`.
4. Separate queued, draft, published, failed, and pending-approval counts. Prioritize active publishing failures and disconnected channels.
5. Keep the review read-only unless the user explicitly requests an operational action.

## Channel setup and maintenance

Use these only when the user asks for the change.

- **Find broken channels:** `postsider_list_channels` marks a channel that needs attention with `refreshNeeded` (token expired, reconnect needed), `inBetweenSteps` (connection never finished) or `disabled`.
- **Connect or reconnect:** call `postsider_connect_channel` and give the user the returned link. The user must open it and approve access on the platform; you cannot do that step. For a broken channel pass its id as `reconnectChannelId` so it is renewed instead of duplicated. Afterwards call `postsider_list_channels` and confirm the channel is present and no longer needs a refresh.
- **Posting times:** read with `postsider_get_queue_plan` before `postsider_set_queue_plan`, which replaces the whole plan. Each slot is `{time, days?}`: minutes from midnight in the plan's timezone (09:00 is 540) and optional weekdays 0 (Sunday) to 6. Send back the slots you keep with their `days`, or the weekday restrictions are lost. `postsider_get_smart_slots` suggests good times without changing anything.
- **Clients:** `postsider_set_channel_customer` assigns a channel to a client by name; an empty name removes it.
- **On/off:** `postsider_set_channel_enabled` pauses a single channel without disconnecting it. Prefer it over `postsider_disconnect_channel`.
- **Disconnect:** `postsider_disconnect_channel` is destructive for scheduling: the channel's unpublished posts become drafts and nothing is published until it is connected again. State that and get confirmation first.
- If a tool says the connection lacks the `channels:write` scope, tell the user to reconnect PostSider and approve it; do not try another route.

## Reusable content

`postsider_get_content_library` lists saved hashtag groups, caption templates and UTM presets. Prefer them over inventing hashtags or tracking parameters. `postsider_save_library_item` replaces an item when given an `id`, so read it first. Deleting an item or a media file (`postsider_delete_library_item`, `postsider_delete_media`) is permanent: confirm first, and for media check that no post still uses it.

## Emergency pause

`postsider_pause_publishing` halts all publishing for the organization and parks queued posts. It cannot resume publishing.

- Use it only when the user explicitly asks to pause all publishing or clearly reports an active incident and asks you to stop publication.
- Before calling it, state that the pause affects the whole organization and that an owner must resume publishing in the PostSider dashboard.
- A clear instruction such as "pause all publishing now" is authorization; do not add another approval round.
- Call `postsider_get_publishing_state` after the pause and report the verified state.
- Do not use the pause as a diagnostic test.

Do not delete posts in this workflow. If the user asks to delete a post, first call `postsider_get_post`, show the exact post group and channel versions, and obtain confirmation for that irreversible deletion before using `postsider_delete_post`.

## Output

Report the inspected period, operational counts, actionable failures, customer scope, pending approvals, and verified publishing state. Do not expose credentials, tokens, internal telemetry, or unrelated personal data.
