---
name: postsider-approval-workflow
description: Validate a PostSider draft, send it to human approval, and check its approval status. Use when the user asks whether a draft is ready, wants review before publishing, or asks about a pending approval.
---

# Validate and request approval

Use this skill for the human-review path. The user's explicit instructions take precedence over this workflow.

## Inputs

Identify the draft from the user's description. If no unique post id is provided, call `postsider_list_posts` for a narrow relevant range and ask the user to choose only when multiple drafts still match.

## Workflow

1. Call `postsider_get_post` for the selected post and confirm its content, channel versions, and current state.
2. Call `postsider_get_post_missing_fields`.
3. If required fields are missing, report them and stop. Do not claim the draft is ready and do not submit it for approval.
4. If the user asked only for a readiness check, stop after reporting the validation result.
5. If the user asked to send the validated draft for review, call `postsider_request_approval` once.
6. Call `postsider_get_approval_status` and report the stored approval state.
7. If the request fails, report a concise actionable error without credentials, tokens, debug payloads, or internal telemetry. Do not retry the write blindly.

Requesting approval does not publish the post. Never describe `PENDING` or `APPROVED` as `PUBLISHED`.

## Output

Report:
- selected post id and channels;
- validation result and any missing fields;
- whether an approval request was created;
- verified approval status;
- any fact that remains unverified.
