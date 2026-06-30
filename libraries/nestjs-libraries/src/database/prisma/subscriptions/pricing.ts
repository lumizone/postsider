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

// NOTE: Only `channel`, `posts_per_month` and `team_members` are actually
// enforced right now. Every other feature flag (ai, image/video generation,
// public_api, webhooks, community_features, etc.) is disabled across
// all tiers because those features are not built/available yet. Re-enable them
// per tier when the corresponding feature ships.
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
    ai: false,
    import_from_channels: false,
    image_generator: false,
    image_generation_count: 0,
    generate_videos: 0,
    public_api: false,
    webhooks: 0,
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
    ai: false,
    import_from_channels: false,
    image_generator: false,
    image_generation_count: 0,
    generate_videos: 0,
    public_api: false,
    webhooks: 0,
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
    ai: false,
    import_from_channels: false,
    image_generator: false,
    image_generation_count: 0,
    generate_videos: 0,
    public_api: false,
    webhooks: 0,
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
    ai: false,
    import_from_channels: false,
    image_generator: false,
    image_generation_count: 0,
    generate_videos: 0,
    public_api: false,
    webhooks: 0,
  },
  // SAMURAI — internal owner-only plan. Same access as ULTIMATE but free and
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
    ai: false,
    import_from_channels: false,
    image_generator: false,
    image_generation_count: 0,
    generate_videos: 0,
    public_api: false,
    webhooks: 0,
  },
};
