import { describe, it, expect, beforeAll } from '@jest/globals';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTED_TOOL_COUNT, EXPECTED_TOOL_NAMES } from './tool-inventory.js';

/**
 * Protocol-level test of the built stdio entrypoint.
 *
 * This suite speaks raw newline-delimited JSON-RPC to `dist/index.js` instead of
 * using the SDK client, because the point is to observe the real bytes the
 * process writes:
 *   - stdout must carry protocol frames only (it is the MCP channel),
 *   - every log line must go to stderr,
 *   - a missing API key must exit 1 having written nothing to stdout.
 *
 * It requires a prior build: run `pnpm --filter @postsider/mcp build` first.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(here, '..');
const ENTRY = path.resolve(here, '..', '..', 'dist', 'index.js');
const API_KEY = 'stdio-test-key';

interface JsonRpcMessage {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface StdioHarness {
  child: ChildProcessWithoutNullStreams;
  messages: JsonRpcMessage[];
  /** Any stdout line that was not a JSON-RPC frame: must stay empty. */
  strayStdout: string[];
  /** stdout bytes with no terminating newline; read only after exit. */
  residualStdout: () => string;
  stderr: () => string;
  request: (id: number, method: string, params?: unknown) => Promise<JsonRpcMessage>;
  close: () => Promise<void>;
}

/** Spawn the built server and speak MCP over its stdio pipes. */
function spawnServer(env: Record<string, string | undefined>): StdioHarness {
  const child = spawn(process.execPath, [ENTRY], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const messages: JsonRpcMessage[] = [];
  const strayStdout: string[] = [];
  const pending = new Map<number, (message: JsonRpcMessage) => void>();
  let stderrText = '';
  let buffered = '';

  child.stdout.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8');
    for (;;) {
      const newline = buffered.indexOf('\n');
      if (newline === -1) {
        break;
      }
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as JsonRpcMessage;
        messages.push(parsed);
        if (parsed.id !== undefined) {
          pending.get(parsed.id)?.(parsed);
          pending.delete(parsed.id);
        }
      } catch {
        // Anything non-JSON on stdout is a protocol violation, recorded rather
        // than thrown so the assertion can report it.
        strayStdout.push(line);
      }
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    stderrText += chunk.toString('utf8');
  });

  return {
    child,
    messages,
    strayStdout,
    stderr: () => stderrText,
    /**
     * Any stdout bytes still sitting in the buffer, i.e. not yet terminated by a
     * newline. Read this only after the process has exited: a partial protocol
     * frame or a raw log line written at shutdown would otherwise escape the
     * purity assertion.
     */
    residualStdout: () => buffered,
    request: (id, method, params) =>
      new Promise<JsonRpcMessage>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no reply to ${method} within 10s`)),
          10_000
        );
        pending.set(id, (message) => {
          clearTimeout(timer);
          resolve(message);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      }),
    close: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        child.once('close', () => resolve());
        child.kill();
      }),
  };
}

/** Newest modification time of a compiled source file, ignoring the tests. */
function newestSourceMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestSourceMtime(full));
    } else if (entry.name.endsWith('.ts')) {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

beforeAll(() => {
  if (!existsSync(ENTRY)) {
    throw new Error(
      `Missing ${ENTRY}. Run "pnpm --filter @postsider/mcp build" before this suite.`
    );
  }

  // The published bin is executed through its shebang, so the built entry needs
  // both the shebang and the executable bit. Spawning it with `node` would hide
  // a regression in either.
  const shebang = readFileSync(ENTRY, 'utf8').split('\n', 1)[0].trim();
  if (shebang !== '#!/usr/bin/env node') {
    throw new Error(
      `${ENTRY} must start with "#!/usr/bin/env node", found ${JSON.stringify(shebang)}.`
    );
  }
  if (process.platform !== 'win32' && (statSync(ENTRY).mode & 0o111) === 0) {
    throw new Error(
      `${ENTRY} is not executable. Run "pnpm --filter @postsider/mcp build", which chmods it.`
    );
  }

  // A stale build would make every assertion below test old code.
  const newestSource = newestSourceMtime(SRC_DIR);
  if (newestSource > statSync(ENTRY).mtimeMs) {
    throw new Error(
      `${ENTRY} is older than the sources in ${SRC_DIR}. Run "pnpm --filter @postsider/mcp build" before this suite.`
    );
  }
});

describe('stdio entrypoint', () => {
  it('completes initialize and tools/list with the 19 tools, stdout clean', async () => {
    const harness = spawnServer({
      ...process.env,
      POSTSIDER_API_KEY: API_KEY,
      POSTSIDER_API_URL: 'https://api.postsider.com',
    });

    let initError: unknown;
    let initName: string | undefined;
    let listedError: unknown;
    let toolNames: string[] = [];

    try {
      const init = await harness.request(1, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'stdio-test', version: '1.0.0' },
      });
      initError = init.error;
      initName = (
        init.result as { serverInfo?: { name?: string } } | undefined
      )?.serverInfo?.name;

      // The initialized notification has no id and produces no reply.
      harness.child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
      );

      const listed = await harness.request(2, 'tools/list');
      listedError = listed.error;
      const listedTools = (
        listed.result as { tools?: { name: string }[] } | undefined
      )?.tools;
      toolNames = (listedTools ?? []).map((tool) => tool.name);
    } finally {
      // Assert stdout purity only AFTER the process has exited, so anything it
      // writes while shutting down is captured too.
      await harness.close();
    }

    expect(initError).toBeUndefined();
    expect(initName).toBe('postsider');
    expect(listedError).toBeUndefined();

    expect(toolNames).toHaveLength(EXPECTED_TOOL_COUNT);
    expect([...toolNames].sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());

    // stdout is the protocol channel: not one non-protocol byte may appear,
    // including an unterminated trailing fragment.
    expect(harness.strayStdout).toEqual([]);
    expect(harness.residualStdout()).toBe('');
    expect(harness.stderr()).toContain('PostSider MCP server running (stdio)');
  }, 30_000);

  it('exits 1 with an empty stdout when the API key is missing', async () => {
    const env = { ...process.env };
    delete env.POSTSIDER_API_KEY;

    const child = spawn(process.execPath, [ENTRY], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      child.once('close', (code) => resolve(code));
    });

    expect(exitCode).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('POSTSIDER_API_KEY is not set');
  }, 30_000);
});
