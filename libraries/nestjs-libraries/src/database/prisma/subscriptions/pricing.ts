export interface PricingInnerInterface {
  current: string;
  month_price: number;
  year_price: number;
  channel?: number;
  posts_per_month: number;
  team_members: boolean;
  community_features: boolean;
  featured_by_postsider: boolean;
  ai: boolean;
  // User-facing AI actions, not underlying provider input/output tokens.
  // `null` is reserved for the owner-only unlimited SAMURAI tier.
  ai_uses_per_month: number | null;
  import_from_channels: boolean;
  image_generator?: boolean;
  image_generation_count: number;
  generate_videos: number;
  public_api: boolean;
  webhooks: number;
}
export interface PricingInterface {
  [key: string]: PricingInnerInterface;
}

// NOTE: `channel`, `posts_per_month`, `team_members`, `ai`, and `webhooks` are
// enforced. Public API access is authenticated by API key and rate-limited at
// the public API boundary, so `public_api` documents plan availability rather
// than adding a second route-level gate.
export const pricing: PricingInterface = {
  FREE: {
    current: 'FREE',
    month_price: 0,
    year_price: 0,
    channel: 0,
    posts_per_month: 0,
    team_members: false,
    community_features: false,
    featured_by_postsider: false,
    ai: false,
    ai_uses_per_month: 0,
    import_from_channels: false,
    image_generator: false,
    image_generation_count: 0,
    generate_videos: 0,
    public_api: false,
    webhooks: 0,
  },
  STANDARD: {
    current: 'STANDARD',
    month_price: 20,
    year_price: 200,
    channel: 5,
    posts_per_month: 400,
    team_members: false,
    community_features: false,
    featured_by_postsider: false,
    ai: true,
    ai_uses_per_month: 50,
    import_from_channels: false,
    image_generator: false,
    image_generation_count: 0,
    generate_videos: 0,
    public_api: true,
    webhooks: 2,
  },
  TEAM: {
    current: 'TEAM',
    month_price: 35,
    year_price: 350,
    channel: 10,
    posts_per_month: 1000000,
    team_members: true,
    community_features: false,
    featured_by_postsider: false,
    ai: true,
    ai_uses_per_month: 150,
    import_from_channels: false,
    image_generator: false,
    image_generation_count: 0,
    generate_videos: 0,
    public_api: true,
    webhooks: 10,
  },
  PRO: {
    current: 'PRO',
    month_price: 45,
    year_price: 450,
    channel: 30,
    posts_per_month: 1000000,
    team_members: true,
    community_features: false,
    featured_by_postsider: false,
    ai: true,
    ai_uses_per_month: 500,
    import_from_channels: false,
    image_generator: false,
    image_generation_count: 0,
    generate_videos: 0,
    public_api: true,
    webhooks: 30,
  },
  ULTIMATE: {
    current: 'ULTIMATE',
    month_price: 90,
    year_price: 900,
    channel: 100,
    posts_per_month: 1000000,
    team_members: true,
    community_features: false,
    featured_by_postsider: false,
    ai: true,
    ai_uses_per_month: 1000,
    import_from_channels: false,
    image_generator: false,
    image_generation_count: 0,
    generate_videos: 0,
    public_api: true,
    webhooks: 10000,
  },
  // SAMURAI - internal owner-only plan. Same access as ULTIMATE but free and
  // never charged. Not shown in checkout/pricing UI. Set manually in the DB
  // (subscription.subscriptionTier = 'SAMURAI') for owner accounts only.
  SAMURAI: {
    current: 'SAMURAI',
    month_price: 0,
    year_price: 0,
    channel: 1000000,
    posts_per_month: 1000000,
    team_members: true,
    community_features: false,
    featured_by_postsider: false,
    ai: true,
    ai_uses_per_month: null,
    import_from_channels: false,
    image_generator: false,
    image_generation_count: 0,
    generate_videos: 0,
    public_api: true,
    webhooks: 10000,
  },
};
