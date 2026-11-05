import type { Metadata } from "next";
import { ApproverLinkView } from "@/components/approver-link-view";

// Signed single use link from an approval email: /approve/<token>. The token
// must never leak through Referer and the page must never be indexed.
export const metadata: Metadata = {
  title: "Approval \u00b7 PostSider",
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ApproverLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ApproverLinkView token={token} />;
}
