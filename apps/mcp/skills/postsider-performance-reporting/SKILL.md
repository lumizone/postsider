---
name: postsider-performance-reporting
description: Analyze PostSider post and channel performance over a defined period. Use when the user asks for analytics, comparisons, best-performing channels, post results, or a performance summary.
---

# Report PostSider performance

Use this skill for read-only analytics. The user's explicit instructions take precedence over this workflow.

## Inputs

Establish:
- date range and timezone;
- channels or posts to compare;
- metric or business question, if the user specified one.

If the user says "recent" without a range, use the previous 30 complete days and state the range. Never invent unavailable metrics or treat missing analytics as zero.

## Workflow

1. Call `postsider_list_channels` to resolve channel names and ids when channel comparison is requested.
2. Call `postsider_get_channel_analytics` for each requested channel and the same date boundaries.
3. For a specific post, resolve it with `postsider_list_posts` or a provided id, then call `postsider_get_post_analytics`.
4. Compare only metrics returned on a common basis. If platforms expose different metrics, label them separately rather than combining unlike values.
5. Use `postsider_get_agency_overview` only when the user asks for an organization-wide operational summary; do not substitute operational counts for performance metrics.

Do not create, update, delete, approve, pause, upload, schedule, or publish anything.

## Output

Include:
- exact date range and timezone;
- metrics returned by each platform;
- comparison method used;
- the best performer only when the data supports that conclusion;
- "no data returned" for an empty analytics response, never a fabricated zero.
