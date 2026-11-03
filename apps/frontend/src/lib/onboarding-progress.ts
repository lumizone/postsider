/**
 * First-run intent is only a UI preference, not a plan, permission or
 * authenticated API claim. It is intentionally local to a browser, user and
 * organization. Never persist API keys, OAuth tokens or post content here.
 */
export type OnboardingIntent = "agents" | "social";

export interface OnboardingProgress {
  intent: OnboardingIntent;
  completed: boolean;
  dismissed: boolean;
}

const PREFIX = "postsider:onboarding:v3:";

export function onboardingProgressKey(userId: string, orgId: string): string {
  return `${PREFIX}${userId}:${orgId}`;
}

export function readOnboardingProgress(
  userId: string | null | undefined,
  orgId: string | null | undefined,
): OnboardingProgress | null {
  if (typeof window === "undefined" || !userId || !orgId) return null;
  try {
    const raw = window.localStorage.getItem(onboardingProgressKey(userId, orgId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed || typeof parsed !== "object" ||
      !("intent" in parsed) ||
      (parsed.intent !== "agents" && parsed.intent !== "social")
    ) return null;
    const value = parsed as Partial<OnboardingProgress>;
    return {
      intent: parsed.intent,
      completed: value.completed === true,
      dismissed: value.dismissed === true,
    };
  } catch {
    return null;
  }
}

export function saveOnboardingProgress(
  userId: string | null | undefined,
  orgId: string | null | undefined,
  value: OnboardingProgress,
): void {
  if (typeof window === "undefined" || !userId || !orgId) return;
  try {
    window.localStorage.setItem(onboardingProgressKey(userId, orgId), JSON.stringify(value));
  } catch {
    // Private browsing/storage restrictions must never block onboarding.
  }
}

export function markOnboardingCompleted(
  userId: string | null | undefined,
  orgId: string | null | undefined,
): void {
  const previous = readOnboardingProgress(userId, orgId);
  if (!previous) return;
  saveOnboardingProgress(userId, orgId, { ...previous, completed: true, dismissed: true });
}
