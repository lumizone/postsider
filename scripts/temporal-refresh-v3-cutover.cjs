#!/usr/bin/env node
/**
 * Explicit V1/V2 -> V3 refresh-workflow cutover.
 *
 * Read-only by default. `--apply --confirm-v3-cutover` is required to mutate
 * Temporal. The script re-describes every workflow immediately before acting;
 * a V3 execution is never terminated.
 */
const { Connection, Client } = require('@temporalio/client');
const { PrismaClient } = require('@prisma/client');

const LEGACY_WORKFLOW_TYPES = new Set([
  'refreshTokenWorkflow',
  'refreshTokenWorkflowV2',
]);
const V3_WORKFLOW_TYPE = 'refreshTokenWorkflowV3';
const REFRESH_WORKFLOW_QUERY =
  'WorkflowId STARTS_WITH "refresh_" AND ExecutionStatus = "Running"';
const TERMINATION_REASON = 'explicit refresh workflow V1/V2 to V3 cutover';

function workflowIdFor(integrationId) {
  return `refresh_${integrationId}`;
}

function isEligibleIntegration(integration) {
  return Boolean(
    integration &&
      integration.deletedAt === null &&
      integration.disabled === false &&
      integration.refreshNeeded === false &&
      integration.inBetweenSteps === false &&
      typeof integration.refreshToken === 'string' &&
      integration.refreshToken.length > 0
  );
}

function eligibleWhere(integration) {
  return {
    id: integration.id,
    organizationId: integration.organizationId,
    deletedAt: null,
    disabled: false,
    refreshNeeded: false,
    inBetweenSteps: false,
    refreshToken: { not: '' },
  };
}

const eligibleSelect = {
  id: true,
  organizationId: true,
  deletedAt: true,
  disabled: true,
  refreshNeeded: true,
  inBetweenSteps: true,
  refreshToken: true,
};

function isWorkflowNotFound(error) {
  return error && (error.name === 'WorkflowNotFoundError' || error.code === 5);
}

async function describeWorkflow(client, workflowId) {
  const handle = client.workflow.getHandle(workflowId);
  try {
    return { handle, execution: await handle.describe() };
  } catch (error) {
    if (isWorkflowNotFound(error)) return { handle, execution: null };
    throw error;
  }
}

function isRunning(execution) {
  return execution && execution.status && execution.status.name === 'RUNNING';
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadEligibleIntegrations(prisma) {
  const integrations = await prisma.integration.findMany({
    where: {
      deletedAt: null,
      disabled: false,
      refreshNeeded: false,
      inBetweenSteps: false,
      refreshToken: { not: '' },
    },
    select: eligibleSelect,
  });
  return integrations.filter(isEligibleIntegration);
}

async function isStillEligible(prisma, integration) {
  const current = await prisma.integration.findFirst({
    where: eligibleWhere(integration),
    select: eligibleSelect,
  });
  return isEligibleIntegration(current);
}

async function listRunningRefreshWorkflows(client) {
  const workflows = [];
  for await (const summary of client.workflow.list({
    query: REFRESH_WORKFLOW_QUERY,
  })) {
    const { execution } = await describeWorkflow(client, summary.workflowId);
    if (isRunning(execution)) {
      workflows.push({ workflowId: summary.workflowId, type: execution.type });
    }
  }
  return workflows;
}

function makePlan(eligibleIntegrations, runningWorkflows) {
  const legacy = [];
  const v3 = [];
  const unknown = [];

  for (const workflow of runningWorkflows) {
    if (LEGACY_WORKFLOW_TYPES.has(workflow.type)) {
      legacy.push(workflow);
    } else if (workflow.type === V3_WORKFLOW_TYPE) {
      v3.push(workflow);
    } else {
      unknown.push(workflow);
    }
  }

  const runningIds = new Set(runningWorkflows.map((workflow) => workflow.workflowId));
  return {
    eligibleIntegrations,
    legacy,
    v3,
    unknown,
    eligibleWithoutRunningWorkflow: eligibleIntegrations.filter(
      (integration) => !runningIds.has(workflowIdFor(integration.id))
    ),
  };
}

async function waitForLegacyToClose(client, workflowId, sleep) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const described = await describeWorkflow(client, workflowId);
    if (!isRunning(described.execution)) return described.execution;
    if (!LEGACY_WORKFLOW_TYPES.has(described.execution.type)) {
      return described.execution;
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for legacy workflow ${workflowId} to close`);
}

async function terminateLegacyWorkflows(client, workflows, sleep) {
  const terminated = [];
  const skipped = [];

  for (const workflow of workflows) {
    // Visibility can lag. Re-describe immediately before terminating so a V3
    // execution that won a race is always left untouched.
    const described = await describeWorkflow(client, workflow.workflowId);
    if (!isRunning(described.execution)) {
      skipped.push({ workflowId: workflow.workflowId, reason: 'already closed' });
      continue;
    }
    if (!LEGACY_WORKFLOW_TYPES.has(described.execution.type)) {
      skipped.push({
        workflowId: workflow.workflowId,
        reason: `current type is ${described.execution.type}`,
      });
      continue;
    }

    if (!described.execution.runId) {
      throw new Error(
        `Refusing to terminate ${workflow.workflowId}: Temporal did not return a run ID`
      );
    }
    // Bind terminate to this described run, not just the reusable workflow ID.
    // If a concurrent V3 starts after the check, Temporal rejects the stale
    // legacy run ID instead of allowing this operation to affect the V3 run.
    const legacyHandle = client.workflow.getHandle(
      workflow.workflowId,
      described.execution.runId
    );
    try {
      await legacyHandle.terminate(TERMINATION_REASON);
    } catch (error) {
      if (isWorkflowNotFound(error)) {
        skipped.push({
          workflowId: workflow.workflowId,
          reason: 'legacy run closed before termination',
        });
        continue;
      }
      throw error;
    }
    await waitForLegacyToClose(client, workflow.workflowId, sleep);
    terminated.push(workflow.workflowId);
  }
  return { terminated, skipped };
}

async function armEligibleV3Workflows(prisma, client, integrations) {
  const started = [];
  const skipped = [];

  for (const integration of integrations) {
    const workflowId = workflowIdFor(integration.id);
    const described = await describeWorkflow(client, workflowId);

    if (isRunning(described.execution)) {
      skipped.push({
        workflowId,
        reason: `running ${described.execution.type}`,
      });
      continue;
    }
    if (!(await isStillEligible(prisma, integration))) {
      skipped.push({ workflowId, reason: 'channel is no longer eligible' });
      continue;
    }

    await client.workflow.start(V3_WORKFLOW_TYPE, {
      workflowId,
      args: [
        {
          integrationId: integration.id,
          organizationId: integration.organizationId,
        },
      ],
      taskQueue: 'main',
      // A reconnect or bootstrap re-arm may start V3 concurrently. Reuse it;
      // never use TERMINATE_EXISTING here because it could stop a live V3.
      workflowIdConflictPolicy: 'USE_EXISTING',
      workflowIdReusePolicy: 'ALLOW_DUPLICATE',
    });

    const afterStart = await describeWorkflow(client, workflowId);
    if (!isRunning(afterStart.execution) || afterStart.execution.type !== V3_WORKFLOW_TYPE) {
      throw new Error(
        `Refusing to report ${workflowId} armed: current type is ${
          afterStart.execution ? afterStart.execution.type : 'absent'
        }`
      );
    }
    started.push(workflowId);
  }
  return { started, skipped };
}

async function runCutover({ prisma, client, apply = false, sleep = sleepMs }) {
  const eligibleIntegrations = await loadEligibleIntegrations(prisma);
  const runningWorkflows = await listRunningRefreshWorkflows(client);
  const plan = makePlan(eligibleIntegrations, runningWorkflows);

  if (!apply) return { mode: 'dry-run', plan };

  const termination = await terminateLegacyWorkflows(client, plan.legacy, sleep);
  const arming = await armEligibleV3Workflows(prisma, client, eligibleIntegrations);
  return { mode: 'apply', plan, termination, arming };
}

function parseArgs(args) {
  const supplied = new Set(args);
  const allowed = new Set(['--dry-run', '--apply', '--confirm-v3-cutover']);
  for (const arg of supplied) {
    if (!allowed.has(arg)) throw new Error(`Unknown option: ${arg}`);
  }
  if (supplied.has('--dry-run') && supplied.has('--apply')) {
    throw new Error('Use either --dry-run or --apply, not both');
  }
  if (supplied.has('--apply') && !supplied.has('--confirm-v3-cutover')) {
    throw new Error('--apply requires --confirm-v3-cutover');
  }
  if (supplied.has('--confirm-v3-cutover') && !supplied.has('--apply')) {
    throw new Error('--confirm-v3-cutover is only valid with --apply');
  }
  return { apply: supplied.has('--apply') };
}

function printResult(result) {
  const { plan } = result;
  console.log(`Mode: ${result.mode}`);
  console.log(`Eligible current channels: ${plan.eligibleIntegrations.length}`);
  console.log(`Running legacy V1/V2 refresh workflows: ${plan.legacy.length}`);
  console.log(`Running V3 refresh workflows: ${plan.v3.length}`);
  console.log(`Other running refresh_* workflows left untouched: ${plan.unknown.length}`);
  console.log(
    `Eligible channels without a running refresh workflow: ${plan.eligibleWithoutRunningWorkflow.length}`
  );
  if (result.mode === 'apply') {
    console.log(`Terminated legacy workflows: ${result.termination.terminated.length}`);
    console.log(`Started V3 workflows: ${result.arming.started.length}`);
    console.log(`Skipped actions: ${result.termination.skipped.length + result.arming.skipped.length}`);
  }
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  let connection;
  const prisma = new PrismaClient();
  try {
    connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
      ...(process.env.TEMPORAL_TLS === 'true' ? { tls: true } : {}),
      ...(process.env.TEMPORAL_API_KEY ? { apiKey: process.env.TEMPORAL_API_KEY } : {}),
    });
    const client = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    });
    printResult(await runCutover({ prisma, client, apply }));
  } finally {
    await connection?.close();
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  LEGACY_WORKFLOW_TYPES,
  REFRESH_WORKFLOW_QUERY,
  TERMINATION_REASON,
  V3_WORKFLOW_TYPE,
  armEligibleV3Workflows,
  isEligibleIntegration,
  makePlan,
  parseArgs,
  runCutover,
  workflowIdFor,
};
