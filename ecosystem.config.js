/**
 * pm2 process definitions for the production image.
 *
 * Every app is started as `node` DIRECTLY. pm2 only ever signals the process it
 * spawned, and the `pnpm` / `dotenv` wrappers the dev scripts use do not forward
 * SIGTERM to their child. pm2 therefore used to supervise a wrapper four levels
 * above the real process:
 *
 *   pm2 -> pnpm -> sh -c -> dotenv -> node   <- the actual app
 *
 * so `pm2 restart orchestrator` killed the wrapper and left the real node
 * orphaned, still holding :3002, and every new incarnation crash-looped on
 * EADDRINUSE. See CLAUDE.md "Deploy notes".
 *
 * Env comes from the container environment (compose `env_file:`), so the
 * `dotenv -e ../../.env` of the dev scripts is a no-op here — /app/.env does not
 * exist in the image.
 */

const APP_DIR = '/app';

/**
 * Never give up on a failing process, but back off between attempts so a hard
 * failure (Temporal unreachable, port taken) does not hammer a RAM-tight host.
 * `min_uptime` resets the unstable-restart counter once a process has held for
 * 30s, so max_restarts only trips on a genuine crash-loop.
 */
const common = {
  exec_mode: 'fork',
  autorestart: true,
  min_uptime: 30000,
  max_restarts: 100,
  exp_backoff_restart_delay: 5000,
  kill_timeout: 10000,
};

module.exports = {
  apps: [
    // max_memory_restart: a slow leak used to be "handled" only by the cgroup
    // OOM killer at the container's 3072M — which kills whichever process is
    // fattest, possibly mid-publish. Restarting the leaking app at its own
    // bound is controlled and graceful (SIGTERM + kill_timeout). Bounds sum to
    // ~4GB nominal but real usage is far below; the point is per-process
    // containment before the shared cgroup limit is threatened.
    {
      ...common,
      name: 'frontend',
      // Absolute path: with node-linker=hoisted there is no
      // apps/frontend/node_modules, every dep lives in the root one.
      script: `${APP_DIR}/node_modules/next/dist/bin/next`,
      args: 'start -p 4200',
      cwd: `${APP_DIR}/apps/frontend`,
      max_memory_restart: '768M',
    },
    {
      ...common,
      name: 'backend',
      script: `${APP_DIR}/apps/backend/dist/apps/backend/src/main.js`,
      node_args: ['--experimental-require-module'],
      cwd: `${APP_DIR}/apps/backend`,
      max_memory_restart: '1024M',
    },
    {
      ...common,
      name: 'orchestrator',
      script: `${APP_DIR}/apps/orchestrator/dist/apps/orchestrator/src/main.js`,
      node_args: ['--experimental-require-module'],
      cwd: `${APP_DIR}/apps/orchestrator`,
      // Temporal workers get 30s to drain in-flight activities on shutdown
      // (nestjs-temporal-core shutdownTimeout), so outlive that before SIGKILL
      // rather than cutting a publish in half.
      kill_timeout: 35000,
      // Startup peak of the ~40 bundled workers is ~2.5G; steady-state is
      // lower. 2800M restarts a leak before the 3072M cgroup OOM does it the
      // hard way, without tripping on the legitimate boot peak.
      max_memory_restart: '2800M',
    },
  ],
};
