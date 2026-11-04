/** Stand-in for PostPolicyGateService in controller specs that do not test policies. */
export const passthroughPolicyGate = {
  async preflightWrite() {
    return {
      outcome: { effect: 'ALLOW', matched: [], channels: [] },
      approvalIntegrationIds: new Set<string>(),
    };
  },
  async finishCreate(_orgId: string, created: any[]) {
    return created;
  },
  async gateStatus() {
    return {
      proceed: true,
      policy: { effect: 'ALLOW', matched: [], channels: [] },
      approvalRequested: false,
    };
  },
};
