import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../libraries/nestjs-libraries/src/integrations/integration.manager.ts', import.meta.url),
  'utf8'
);

const providers = [...source.matchAll(/new (\w+Provider)\(\)/g)].map((match) => match[1]);
const identifiers = [...source.matchAll(/new (\w+Provider)\(\)/g)].map((match) => match[1]);

if (providers.length < 30) {
  throw new Error(`Expected at least 30 registered providers, found ${providers.length}`);
}

if (new Set(identifiers).size !== identifiers.length) {
  throw new Error('Duplicate provider class in socialIntegrationList');
}

console.log(`Provider registry check passed: ${providers.length} providers registered`);
