import { api } from "./api";

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ changed: boolean }> {
  return api.post<{ changed: boolean }>("/user/change-password", {
    currentPassword,
    newPassword,
  });
}
