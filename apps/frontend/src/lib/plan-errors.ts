/**
 * Maps backend 402 (Payment Required) plan-limit errors into friendly,
 * human-readable messages.
 *
 * The backend's SubscriptionException returns a body of the shape
 * `{ section, action }` with HTTP 402. There is no `message`, so the raw
 * ApiError surfaces as "Payment Required" — this helper translates the
 * `section` into something a user actually understands.
 */
export function planLimitMessage(err: unknown, fallback = "Action failed"): string {
  const anyErr = err as { status?: number; body?: unknown; message?: string };

  if (anyErr?.status === 402) {
    const section =
      anyErr.body && typeof anyErr.body === "object" && "section" in anyErr.body
        ? String((anyErr.body as { section?: unknown }).section)
        : "";

    switch (section) {
      case "posts_per_month":
        return "You've reached your monthly post limit. Upgrade your plan in Billing to keep publishing.";
      case "channel":
        return "You've reached your channel limit on this plan. Upgrade in Billing to connect more channels.";
      case "team_members":
        return "Your plan doesn't include team members. Upgrade to Team or higher in Billing to invite people.";
      case "webhooks":
        return "Your plan doesn't include webhooks. Upgrade your plan in Billing.";
      case "ai":
        return "Your plan doesn't include AI features. Upgrade your plan in Billing.";
      default:
        return "Your plan doesn't allow this action. Open Billing to upgrade.";
    }
  }

  if (anyErr?.message && anyErr.message.trim()) {
    return anyErr.message;
  }
  return fallback;
}

/** Whether an error is a plan-limit (402) error. */
export function isPlanLimitError(err: unknown): boolean {
  return (err as { status?: number })?.status === 402;
}
