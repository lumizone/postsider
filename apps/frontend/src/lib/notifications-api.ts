import { api } from "./api";

/**
 * In-app notifications.
 *
 * The backend has been writing these all along (publish succeeded/failed,
 * "reconnect this channel", approval requests) — `NotificationService.
 * inAppNotification` stores every one of them — but the dashboard never had a
 * place to show them, so 102 of them had accumulated unseen in production
 * before this was wired up. The channel-reconnect alerts in particular were
 * only ever reachable by email, which meant they were invisible for the whole
 * period the sending domain was unverified.
 */
export interface AppNotification {
  createdAt: string;
  /** Rendered English text — email copy, and the fallback for the dashboard. */
  content: string;
  /** Where the customer should go to act on it (e.g. reconnect a channel). */
  link?: string | null;
  /** Event identifier used to pick a translated message. */
  eventKey?: string | null;
  /** JSON object of placeholder values for that message. */
  eventParams?: string | null;
}

export interface NotificationList {
  lastReadNotifications: string;
  notifications: AppNotification[];
}

/** Unread count only — cheap enough to poll. */
export async function getNotificationCount(): Promise<number> {
  const res = await api.get<{ total: number }>("/notifications", undefined, {
    silent: true,
  });
  return res?.total ?? 0;
}

/**
 * The 10 most recent notifications.
 *
 * NOTE: reading the list MARKS EVERYTHING READ server-side (it bumps the
 * user's `lastReadNotifications`), so only call it when the user actually
 * opens the panel — never on a poll, or the badge would clear itself.
 */
export async function getNotificationList(): Promise<NotificationList> {
  return api.get<NotificationList>("/notifications/list", undefined, {
    silent: true,
  });
}

/**
 * Empty the list. Soft delete server-side, and org-wide — the list is shared by
 * every member of the organization, so clearing clears it for all of them.
 */
export async function clearNotifications(): Promise<{ cleared: number }> {
  return api.del<{ cleared: number }>("/notifications");
}
