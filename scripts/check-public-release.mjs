import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'buffer' })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const allowedEnvTemplates = new Set(['.env.example', '.env.local.example']);
const forbiddenPath = [
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)(?:CLAUDE\.md|graphify-out)(?:\/|$)/i,
  /(^|\/)docs\/.*audit.*$/i,
  /(^|\/)(?:.*\.dump|.*\.pem|.*\.key)$/i,
];
const forbiddenText = [
  { label: 'GitHub token', pattern: /\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { label: 'Polar token', pattern: /\b(?:polar_oat|whsec)_[A-Za-z0-9_-]{12,}\b/ },
  { label: 'private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  {
    label: 'production infrastructure reference',
    pattern: new RegExp(
      [
        ['vps', 'bd41b901'].join('-'),
        ['postsider', 'production'].join('_'),
        ['darkdynasty', 'cloud'].join('\\.'),
      ].join('|'),
      'i'
    ),
  },
];

const failures = [];
for (const file of files) {
  if (!existsSync(file)) continue;

  if (!allowedEnvTemplates.has(file) && forbiddenPath.some((pattern) => pattern.test(file))) {
    failures.push(`${file}: forbidden file path`);
    continue;
  }

  const content = readFileSync(file);
  if (content.includes(0)) continue;
  if (file === 'scripts/check-public-release.mjs') continue;
  const text = content.toString('utf8');
  for (const { label, pattern } of forbiddenText) {
    if (pattern.test(text)) failures.push(`${file}: ${label}`);
  }
}

if (failures.length) {
  console.error('Public release guard failed:\n' + failures.map((line) => `  - ${line}`).join('\n'));
  process.exit(1);
}

console.log(`Public release guard passed for ${files.length} tracked files.`);
