import { describe, it, expect } from '@jest/globals';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The release wiring is spread across four manifests that no compiler checks:
 * `package.json`, `.claude-plugin/plugin.json`, `.mcp.json` and `server.json`,
 * plus the marketplace file at the repository root. A rename in any one of them
 * breaks the main Claude Code install path silently, because the failure only
 * appears when a user's client tries to start this server.
 */
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ROOT = path.resolve(PKG_DIR, '..', '..');

function readJson(file: string): any {
  return JSON.parse(readFileSync(file, 'utf8'));
}

const pkg = readJson(path.join(PKG_DIR, 'package.json'));
const plugin = readJson(path.join(PKG_DIR, '.claude-plugin', 'plugin.json'));
const serverJson = readJson(path.join(PKG_DIR, 'server.json'));
const mcpConfig = readJson(path.join(PKG_DIR, '.mcp.json'));

describe('release manifests stay wired together', () => {
  it('states one version everywhere a client can read it', () => {
    expect(plugin.version).toBe(pkg.version);
    expect(serverJson.version).toBe(pkg.version);
    expect(serverJson.packages[0].version).toBe(pkg.version);

    // The version the server reports in `initialize` comes from source, not from
    // package.json, so it is checked here as well as in scripts/version-gate.mjs.
    const serverSource = readFileSync(path.join(PKG_DIR, 'src', 'server.ts'), 'utf8');
    const declared = serverSource.match(/POSTSIDER_MCP_SERVER_VERSION\s*=\s*'([^']+)'/);
    expect(declared?.[1]).toBe(pkg.version);
  });

  it('starts the published package at exactly that version', () => {
    const entry = mcpConfig.mcpServers.postsider;

    expect(entry.command).toBe('npx');
    expect(entry.args).toContain('-y');
    expect(entry.args).toContain(`${pkg.name}@${pkg.version}`);
  });

  it('sources the API key from the declared plugin setting', () => {
    // The env name must match what src/index.ts reads, and the placeholder must
    // name a key that plugin.json actually declares.
    const declaredKeys = Object.keys(plugin.userConfig ?? {});
    const placeholder = mcpConfig.mcpServers.postsider.env.POSTSIDER_API_KEY;

    expect(placeholder).toBe('${user_config.api_key}');
    expect(declaredKeys).toContain('api_key');
    expect(plugin.userConfig.api_key.sensitive).toBe(true);
    expect(plugin.userConfig.api_key.required).toBe(true);
  });

  it('declares the registry identity the gate and the registry both check', () => {
    expect(pkg.mcpName).toBe(serverJson.name);
    expect(serverJson.packages[0].identifier).toBe(pkg.name);
    // npm-only distribution: a registry base URL for anything but npm is refused.
    expect(serverJson.packages[0].registryType).toBe('npm');
    expect(serverJson.packages[0].registryBaseUrl).toBeUndefined();
    expect(serverJson.packages[0].transport).toEqual({ type: 'stdio' });
  });

  it('ships every file the plugin and the registry path need', () => {
    for (const required of [
      'dist',
      'skills',
      '.claude-plugin',
      '.mcp.json',
      'server.json',
      'README.md',
      'LICENSE',
      'CHANGELOG.md',
    ]) {
      expect(pkg.files).toContain(required);
    }
  });

  /**
   * The marketplace is optional for a tarball consumer but it is the install
   * path documented in README.md, so when the repository is present it must
   * point at this plugin by the name its own manifest declares.
   */
  it('lists this plugin by the same name in the marketplace file', () => {
    const marketplacePath = path.join(REPO_ROOT, '.claude-plugin', 'marketplace.json');
    if (!existsSync(marketplacePath)) {
      return;
    }

    const marketplace = readJson(marketplacePath);
    const entry = marketplace.plugins.find((item: any) => item.name === plugin.name);

    expect(entry).toBeDefined();
    expect(entry.source).toBe('./apps/mcp');
  });
});
