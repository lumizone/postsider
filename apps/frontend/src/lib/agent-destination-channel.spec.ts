import { destinationToChannel } from './agent-destination-channel';

describe('destinationToChannel', () => {
  const platformOf = (identifier: string) => (identifier === 'x' ? 'X' : identifier);

  it('maps the destination fields', () => {
    const c = destinationToChannel(
      { integrationId: 'i1', integrationName: 'My page', providerIdentifier: 'x', picture: 'https://p/1.png' },
      platformOf
    );
    expect(c).toEqual({
      id: 'i1',
      name: 'My page',
      platform: 'X',
      identifier: 'x',
      color: '#0F0F0F',
      avatarUrl: 'https://p/1.png',
      audience: 0,
      audienceHistory: [],
    });
  });

  it('passes a null picture through', () => {
    const c = destinationToChannel(
      { integrationId: 'i2', integrationName: 'N', providerIdentifier: 'linkedin', picture: null },
      platformOf
    );
    expect(c.avatarUrl).toBeNull();
    expect(c.platform).toBe('linkedin');
    expect(c.audienceHistory).toEqual([]);
  });
});
