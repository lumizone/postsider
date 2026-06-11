import { api } from "./api";

export interface TeamMember {
  role: "SUPERADMIN" | "ADMIN" | "USER";
  user: {
    id: string;
    email: string;
    sendSuccessEmails: boolean;
    sendFailureEmails: boolean;
    sendStreakEmails: boolean;
  };
}

export interface TeamResponse {
  users: TeamMember[];
}

export async function getTeam(): Promise<TeamResponse> {
  return api.get<TeamResponse>("/settings/team");
}

export interface InviteRequest {
  email: string;
  role: "USER" | "ADMIN";
  sendEmail: boolean;
}

export interface InviteResponse {
  email: string;
  /** One-time password. Null if the user already existed. */
  password: string | null;
  message: string;
}

export async function inviteMember(
  body: InviteRequest,
): Promise<InviteResponse> {
  return api.post<InviteResponse>("/settings/team", body);
}

export async function removeMember(userId: string): Promise<void> {
  await api.del(`/settings/team/${userId}`);
}

export async function changeRole(
  userId: string,
  role: "USER" | "ADMIN",
): Promise<void> {
  await api.put(`/settings/team/${userId}/role`, { role });
}
