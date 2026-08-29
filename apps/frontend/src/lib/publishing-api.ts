import { api } from "./api";

export interface PublishingStatePayload {
  state: "ACTIVE" | "PAUSED";
  pausedAt: string | null;
  pausedBy: string | null;
  reason: string | null;
}

export function getPublishingState() {
  return api.get<PublishingStatePayload>("/publishing/state");
}

export function pausePublishing(reason?: string) {
  return api.post<PublishingStatePayload>("/publishing/pause", { reason });
}

export function resumePublishing(behavior: "to_draft" | "auto_resume") {
  return api.post<{ state: string; heldPostsProcessed: number }>(
    "/publishing/resume",
    { behavior }
  );
}
