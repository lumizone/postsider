---
name: postsider-calendar-review
description: Review a PostSider content calendar, connected channels, publishing state, and available scheduling slots. Use when the user asks what is connected, queued, scheduled, published, or free in a date range.
---

# Review the PostSider calendar

Use this skill for read-only calendar and channel questions. The user's explicit instructions take precedence over this workflow.

## Inputs

Obtain only the details needed for the request:
- date range and timezone;
- optional channel or customer filter;
- whether the user wants scheduled posts only or all states.

If the date range is omitted, use the next 14 days and state that choice. Do not guess a channel, customer, post id, or timezone when it changes the result.

## Workflow

1. Call `postsider_list_channels` when channel identity or coverage matters.
2. Call `postsider_get_publishing_state` when the user asks whether publishing is active or when the result will be used to plan a later write.
3. Call `postsider_list_posts` with explicit ISO 8601 range boundaries. Convert the user's local dates to UTC for the tool call and present times back in the user's timezone.
4. If the user asks for the next available slot, resolve the channel id from `postsider_list_channels`, then call `postsider_find_slot` for that channel.
5. Keep `DRAFT`, `QUEUE`, `PUBLISHED`, and `ERROR` separate. An empty result means no matching posts in the inspected range, not a broken connection.

Do not create, update, delete, approve, pause, upload, schedule, or publish anything in this workflow.

## Output

Report:
- the exact range and timezone inspected;
- matching channels and posts grouped clearly;
- publishing state when checked;
- the returned free slot when requested;
- any missing or ambiguous data as unverified rather than inferred.
