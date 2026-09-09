const {
  V3_WORKFLOW_TYPE,
  makePlan,
  parseArgs,
  runCutover,
} = require('./temporal-refresh-v3-cutover.cjs');

const eligible = (id) => ({
  id,
  organizationId: `org-${id}`,
  deletedAt: null,
  disabled: false,
  refreshNeeded: false,
  inBetweenSteps: false,
  refreshToken: 'refresh-token',
});

function workflowClient(executions) {
  const state = new Map(
    Object.entries(executions).map(([workflowId, execution]) => [
      workflowId,
      { runId: workflowId, ...execution },
    ])
  );
  const terminate = jest.fn(async (workflowId) => {
    state.set(workflowId, {
      ...state.get(workflowId),
      status: { name: 'TERMINATED' },
    });
  });
  const start = jest.fn(async (type, options) => {
    const existing = state.get(options.workflowId);
    if (!existing || existing.status.name !== 'RUNNING') {
      state.set(options.workflowId, { type, status: { name: 'RUNNING' } });
    }
  });

  return {
    state,
    terminate,
    start,
    workflow: {
      async *list() {
        for (const [workflowId, execution] of state) {
          if (workflowId.startsWith('refresh_') && execution.status.name === 'RUNNING') {
            yield { workflowId };
          }
        }
      },
      getHandle(workflowId, runId) {
        return {
          describe: async () => {
            const execution = state.get(workflowId);
            if (!execution) {
              const error = new Error('not found');
              error.name = 'WorkflowNotFoundError';
              throw error;
            }
            return execution;
          },
          terminate: () => {
            if (runId && state.get(workflowId)?.runId !== runId) {
              const error = new Error('run not found');
              error.name = 'WorkflowNotFoundError';
              throw error;
            }
            return terminate(workflowId);
          },
        };
      },
      start,
    },
  };
}

function prismaFor(integrations) {
  return {
    integration: {
      findMany: jest.fn().mockResolvedValue(integrations),
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(
          integrations.find(
            (integration) =>
              integration.id === where.id && integration.organizationId === where.organizationId
          ) || null
        )
      ),
    },
  };
}

describe('temporal refresh V3 cutover', () => {
  it('classifies V1/V2 for termination and never includes V3 in that plan', () => {
    const plan = makePlan([eligible('one')], [
      { workflowId: 'refresh_one', type: 'refreshTokenWorkflow' },
      { workflowId: 'refresh_two', type: 'refreshTokenWorkflowV2' },
      { workflowId: 'refresh_three', type: V3_WORKFLOW_TYPE },
    ]);

    expect(plan.legacy.map((workflow) => workflow.workflowId)).toEqual([
      'refresh_one',
      'refresh_two',
    ]);
    expect(plan.v3.map((workflow) => workflow.workflowId)).toEqual(['refresh_three']);
  });

  it('is read-only by default', async () => {
    const client = workflowClient({
      refresh_one: { type: 'refreshTokenWorkflowV2', status: { name: 'RUNNING' } },
    });

    const result = await runCutover({
      prisma: prismaFor([eligible('one')]),
      client,
    });

    expect(result.mode).toBe('dry-run');
    expect(client.terminate).not.toHaveBeenCalled();
    expect(client.start).not.toHaveBeenCalled();
  });

  it('terminates only V1/V2 and starts V3 only for eligible channels', async () => {
    const client = workflowClient({
      refresh_one: { type: 'refreshTokenWorkflow', status: { name: 'RUNNING' } },
      refresh_two: { type: 'refreshTokenWorkflowV2', status: { name: 'RUNNING' } },
      refresh_three: { type: V3_WORKFLOW_TYPE, status: { name: 'RUNNING' } },
    });
    const result = await runCutover({
      prisma: prismaFor([eligible('one'), eligible('three')]),
      client,
      apply: true,
      sleep: jest.fn(),
    });

    expect(client.terminate).toHaveBeenCalledTimes(2);
    expect(client.terminate).toHaveBeenCalledWith('refresh_one');
    expect(client.terminate).toHaveBeenCalledWith('refresh_two');
    expect(client.terminate).not.toHaveBeenCalledWith('refresh_three');
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(client.start).toHaveBeenCalledWith(V3_WORKFLOW_TYPE, {
      workflowId: 'refresh_one',
      args: [{ integrationId: 'one', organizationId: 'org-one' }],
      taskQueue: 'main',
      workflowIdConflictPolicy: 'USE_EXISTING',
      workflowIdReusePolicy: 'ALLOW_DUPLICATE',
    });
    expect(result.termination.terminated).toEqual(['refresh_one', 'refresh_two']);
    expect(result.arming.started).toEqual(['refresh_one']);
    expect(client.state.get('refresh_three').type).toBe(V3_WORKFLOW_TYPE);
  });

  it('is idempotent after V3 is running', async () => {
    const client = workflowClient({
      refresh_one: { type: V3_WORKFLOW_TYPE, status: { name: 'RUNNING' } },
    });

    await runCutover({
      prisma: prismaFor([eligible('one')]),
      client,
      apply: true,
      sleep: jest.fn(),
    });

    expect(client.terminate).not.toHaveBeenCalled();
    expect(client.start).not.toHaveBeenCalled();
  });

  it('does not terminate a workflow that becomes V3 after discovery', async () => {
    let describeCount = 0;
    const terminate = jest.fn();
    const client = {
      workflow: {
        async *list() {
          yield { workflowId: 'refresh_one' };
        },
        getHandle() {
          return {
            describe: async () => {
              describeCount += 1;
              return {
                runId: describeCount === 1 ? 'legacy-run' : 'v3-run',
                type:
                  describeCount === 1
                    ? 'refreshTokenWorkflowV2'
                    : V3_WORKFLOW_TYPE,
                status: { name: 'RUNNING' },
              };
            },
            terminate,
          };
        },
        start: jest.fn(),
      },
    };

    const result = await runCutover({
      prisma: prismaFor([eligible('one')]),
      client,
      apply: true,
      sleep: jest.fn(),
    });

    expect(terminate).not.toHaveBeenCalled();
    expect(client.workflow.start).not.toHaveBeenCalled();
    expect(result.termination.skipped).toEqual([
      { workflowId: 'refresh_one', reason: `current type is ${V3_WORKFLOW_TYPE}` },
    ]);
  });

  it('requires an explicit mutation confirmation', () => {
    expect(parseArgs([])).toEqual({ apply: false });
    expect(() => parseArgs(['--apply'])).toThrow('--confirm-v3-cutover');
    expect(parseArgs(['--apply', '--confirm-v3-cutover'])).toEqual({ apply: true });
  });
});
