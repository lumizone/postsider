import { api } from "@/lib/api";

export interface AgencyClient {
  id: string | null;
  name: string;
  channels: number;
  activeChannels: number;
}

export interface AgencyOverview {
  generatedAt: string;
  windowDays: number;
  summary: {
    clients: number;
    channels: number;
    activeChannels: number;
    queued: number;
    drafts: number;
    published: number;
    errors: number;
    recentErrors: number;
    pendingApprovals: number;
  };
  clients: AgencyClient[];
}

export interface CustomerReport {
  generatedAt: string;
  windowDays: number;
  customer: { id: string; name: string };
  channels: Array<{
    id: string;
    name: string;
    providerIdentifier: string;
    disabled: boolean;
  }>;
  summary: Omit<AgencyOverview["summary"], "clients"> & { channels: number };
}

export const getAgencyOverview = (days: number, apiKey: string) =>
  api.get<AgencyOverview>("/public/v1/overview", { days }, { headers: { Authorization: apiKey }, silent: true });

export const getCustomerReport = (customerId: string, days: number, apiKey: string) =>
  api.get<CustomerReport>(`/public/v1/customers/${customerId}/report`, { days }, { headers: { Authorization: apiKey }, silent: true });
