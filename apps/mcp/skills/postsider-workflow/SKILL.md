---
name: postsider-workflow
description: Use when the user asks to plan, draft, schedule, review or check social media work in PostSider, or to inspect the PostSider calendar, channels, approvals, publishing state or analytics. Enforces a read first and draft first workflow, requires read back verification of anything created, and forbids publishing on the agent's own initiative.
---

# PostSider workflow

PostSider is a shared operational calendar. The human reviews and decides what
goes live; the agent prepares. Every rule below exists to keep that split intact.

## Order of operations

1. **Read before writing.** Establish the current state first with
   `postsider_list_channels` and `postsider_list_posts`. Never guess a channel id
   or a post id; take them from a read result.
2. **Check the kill switch.** Before scheduling anything, call
   `postsider_get_publishing_state`. If publishing is paused, stop and tell the
   user: a paused organization rejects new posts.
3. **Propose before creating.** Show the exact content, the target channel and the
   publish date to the user, and get agreement on the text.
4. **Create a draft, not a schedule and never a publish.** Use
   `postsider_create_post` with `type: "draft"`.
5. **Read it back.** Call `postsider_get_post` with the returned id and report the
   stored content, channel and date. An id from the create response is not proof
   that the post was stored correctly.
6. **Hand over for review.** Use `postsider_request_approval` when the user wants
   the draft in the human approval queue, then `postsider_get_approval_status`.

## Hard rules

- **Never publish on your own initiative.** Do not use `type: "now"` and do not
  schedule a future publish unless the user explicitly asked for that specific
  post to be published or scheduled. "Prepare some posts" is not such a request.
- **Never claim a post is live** without reading it back and checking its state.
- **Never invent** channel ids, customer ids, media paths, dates or analytics
  numbers. Read them, or say that you could not.
- **`postsider_pause_publishing` is an emergency stop.** Use it only when the user
  asks for it or when they describe an ongoing incident. Resuming is human only,
  so say so before using it.
- **`postsider_delete_post` is destructive and wider than it looks.** One id
  deletes the post **and every other channel version in its group**, so read the
  post first with `postsider_get_post`, list the channel versions to the user, and
  confirm the specific post before deleting. Deleting cannot be undone.
- **Report API errors verbatim.** If a call fails, surface the message and do not
  retry blindly. A `423` means publishing is paused for the organization.
- **Validate before requesting approval.** Call
  `postsider_get_post_missing_fields` and fix what it reports.
- **Never print the API key**, and never write it into a file, command or message.

## Read first prompts to use verbatim

To prove the connection works, start with a read only request:

```text
List my connected PostSider channels. Do not create or modify anything.
```

Then, before any write:

```text
Show my PostSider calendar for the next 14 days. Do not create or modify anything.
```

## Draft first prompt

When you are ready to prepare content:

```text
Create one draft only for the selected channel. Show me the exact content first. Do not publish it.
```

## What to report back

- The draft id, its channel, its publish date and the stored text.
- Whether a human approval is pending.
- Anything you could not verify, stated plainly as not verified.
