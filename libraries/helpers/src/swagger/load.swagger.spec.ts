import { readFileSync } from 'fs';
import { join } from 'path';

describe('load.swagger description', () => {
  const source = readFileSync(join(__dirname, 'load.swagger.ts'), 'utf8');

  it('describes OAuth token and API key auth', () => {
    expect(source).toContain('OAuth token (pos_)');
  });

  it('does not mention agent tokens or the Agent Bridge', () => {
    expect(source).not.toContain('agt_');
    expect(source).not.toContain('Agent Bridge');
  });
});
