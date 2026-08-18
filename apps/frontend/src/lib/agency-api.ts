import { api } from "@/lib/api";

export interface AgencyClient {
  id: string | null;
  name: string;
  channels: number;
  activeChannels: number;
  errors: number;
  stuckPosts: number;
  tokenIssues: number;
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
    stuckPosts: number;
    tokenIssues: number;
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

export const getAgencyOverview = (days: number) =>
  api.get<AgencyOverview>("/agency/overview", { days }, { silent: true });

export const getCustomerReport = (customerId: string, days: number) =>
  api.get<CustomerReport>(`/agency/customers/${customerId}/report`, { days }, { silent: true });

export const downloadReportPdf = async (customerId: string, days: number, filename: string) => {
  const blob = await api.download(`/report/customers/${customerId}/pdf`, { days });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
