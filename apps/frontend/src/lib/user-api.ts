import { api } from "./api";

export interface UserPersonal {
  name: string | null;
  lastName: string | null;
  bio: string | null;
  timezone: number;
  picture: { id: string; path: string } | null;
}

export interface EmailNotifications {
  sendSuccessEmails: boolean;
  sendFailureEmails: boolean;
  sendStreakEmails: boolean;
}

export async function getPersonal(): Promise<UserPersonal> {
  return api.get<UserPersonal>("/user/personal");
}

export async function updatePersonal(payload: Partial<UserPersonal>): Promise<unknown> {
  // Backend accepts: name, lastName, bio, timezone, picture
  return api.post("/user/personal", payload);
}

export async function getEmailNotifications(): Promise<EmailNotifications> {
  return api.get<EmailNotifications>("/user/email-notifications");
}

export async function updateEmailNotifications(
  payload: EmailNotifications,
): Promise<unknown> {
  return api.post("/user/email-notifications", payload);
}

export interface RotateApiKeyResponse {
  apiKey?: string;
}

export async function rotateApiKey(): Promise<RotateApiKeyResponse> {
  return api.post<RotateApiKeyResponse>("/user/api-key/rotate", {});
}
