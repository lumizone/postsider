import { api } from "./api";

export interface AssignedUser {
  id: string;
  name: string | null;
  email: string;
}

export const getChannelAssignments = (integrationId: string) =>
  api.get<{ users: AssignedUser[] }>(
    `/integrations/${encodeURIComponent(integrationId)}/assignments`
  );

export const setChannelAssignments = (integrationId: string, userIds: string[]) =>
  api.put(`/integrations/${encodeURIComponent(integrationId)}/assignments`, {
    userIds,
  });
