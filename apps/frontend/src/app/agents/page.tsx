"use client";

import { Suspense } from "react";
import { AgentActivityPage } from "@/components/agent-activity/agent-activity-page";

export default function AgentsPage() {
  return (
    <Suspense fallback={null}>
      <AgentActivityPage />
    </Suspense>
  );
}
