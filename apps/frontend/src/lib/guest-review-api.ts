import { api } from "./api";

export interface GuestReviewPost {
  content: string;
  image: string | null;
  publishDate: string | null;
  channel: {
    name: string;
    providerIdentifier: string;
    picture: string | null;
  } | null;
  branding: { name: string; logo: string | null };
}

export const getGuestReview = (token: string) =>
  api.get<GuestReviewPost>(`/public/approval-review/${encodeURIComponent(token)}`, undefined, {
    silent: true,
  });

export const resolveGuestReview = (
  token: string,
  action: "approve" | "reject",
  identity: { name: string; email: string },
  note?: string,
) =>
  api.post(
    `/public/approval-review/${encodeURIComponent(token)}/resolve`,
    { action, note, guestName: identity.name, guestEmail: identity.email },
    { silent: true },
  );
