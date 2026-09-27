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
