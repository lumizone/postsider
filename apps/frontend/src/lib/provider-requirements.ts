/**
 * Per-provider posting requirements for the composer.
 *
 * This is the single source of truth on the frontend for:
 *  - which provider-specific settings fields to render in the create-post form
 *  - sensible default values (so the backend DTO validation always passes)
 *  - media rules (required / optional / forbidden, counts, type)
 *  - friendly, human warnings (e.g. "TikTok needs a video or photo")
 *
 * It deliberately mirrors the backend providers' `checkValidity(...)` logic and
 * their settings DTOs in:
 *   libraries/nestjs-libraries/src/integrations/social/*.provider.ts
 *   libraries/nestjs-libraries/src/dtos/posts/providers-settings/*.ts
 *
 * The backend overrides the `__type` discriminator from the integration's
 * providerIdentifier and validates the settings object against the matching
 * DTO via a ValidationPipe — so any required field missing here will make the
 * post fail server-side. Keeping defaults + fields in sync prevents that.
 */

/** Lightweight media descriptor used by the composer. */
export interface MediaLike {
  kind: "image" | "video";
  /** Browser-derived duration, available for newly attached videos. */
  durationSeconds?: number;
  /**
   * Original file extension without the dot (e.g. "mp4", "mov", "webm").
   * Carried so validators can reject video containers a provider does not
   * accept (TikTok supports mp4/webm/mov) even when the browser already
   * classified the file as video.
   */
  ext?: string;
}

/** A selectable option for select / channel-picker fields. */
export interface FieldOption {
  value: string;
  label: string;
}

export type FieldType =
  | "text"
  | "textarea"
  | "select"
  | "checkbox"
  | "url"
  | "emails"
  | "tags"
  /** A select whose options are fetched from the backend via a provider tool. */
  | "remote-select";

export interface SettingsField {
  /** Key written into the per-channel settings object (must match the DTO). */
  key: string;
  label: string;
  type: FieldType;
  /** Default value seeded when a channel of this provider is first selected. */
  defaultValue?: unknown;
  /** Whether the post can't be scheduled without this field. */
  required?: boolean;
  /** Options for `select`. */
  options?: FieldOption[];
  placeholder?: string;
  /** Max length for text/textarea inputs (mirrors DTO @MaxLength). */
  maxLength?: number;
  /** Helper text shown under the field. */
  help?: string;
  /**
   * For `remote-select`: the provider "function" name to call through
   * /integrations/function to populate the options (e.g. "boards").
   */
  remoteFn?: string;
  /**
   * For a dependent `remote-select`: the settings key whose value is passed as
   * the `id` param to `remoteFn` (e.g. Whop forum options depend on the chosen
   * company, so `remoteParam: "company"`). Options are re-fetched when it
   * changes; the field stays empty until the parent value is set.
   */
  remoteParam?: string;
  /** Only show this field when `predicate(settings)` is true. */
  showIf?: (settings: Record<string, unknown>) => boolean;
  /** Only render this field for the matching TikTok media state. */
  showForMedia?: "attached" | "photo" | "video";
  /** Keep a required transport default without rendering a user control. */
  hidden?: boolean;
  /**
   * Options come from the channel's creator info rather than a static list.
   * Required by TikTok's Content Posting API audit: the privacy options shown
   * must be exactly `creator_info.privacy_level_options` (a private account is
   * never offered a public option), and the field starts empty — TikTok
   * forbids preselecting a privacy level for the user.
   */
  dynamicOptions?: "tiktok-privacy";
  /**
   * Lock the control when the creator disabled that interaction on TikTok
   * (`duet_disabled` / `stitch_disabled` / `comment_disabled`).
   */
  dynamicDisabled?: "duet" | "stitch" | "comment";
}

export type MediaPolicy = "required" | "optional" | "none";

export interface ProviderRequirement {
  /** Backend provider identifier. */
  identifier: string;
  /** Human label used in messages. */
  label: string;
  /** Maximum characters for the post body. */
  maxLength: number;
  /**
   * Optional dynamic max-length resolver (e.g. X gives premium/verified
   * accounts a higher limit). Takes precedence over `maxLength` when present.
   */
  maxLengthFor?: (ctx: { verified?: boolean }) => number;
  /** Editor flavour (drives nothing fancy here, kept for parity). */
  editor: "none" | "normal" | "markdown" | "html";
  /** Media expectation. */
  media: MediaPolicy;
  /**
   * Plain-language note shown in the composer describing what this provider
   * needs (mirrors the backend @Rules decorator). Optional.
   */
  mediaNote?: string;
  /** Provider-specific settings fields to render. */
  fields: SettingsField[];
  /**
   * Validate the current post for this provider. Mirrors backend checkValidity.
   * Returns an array of human-readable problems (empty = valid).
   */
  validate: (input: ValidationInput) => string[];
}

export interface ValidationInput {
  /** Media attached to the main post, in order. */
  media: MediaLike[];
  /** The provider-specific settings the user has filled in. */
  settings: Record<string, unknown>;
  /** The post body text. */
  body: string;
  /** Whether any thread part / comment carries media (for providers that forbid it). */
  commentsHaveMedia?: boolean;
  /** TikTok creator_info limit for this connected channel. */
  maxVideoDurationSeconds?: number;
}

const PRIVACY_LEVELS: FieldOption[] = [
  { value: "PUBLIC_TO_EVERYONE", label: "Public to everyone" },
  { value: "MUTUAL_FOLLOW_FRIENDS", label: "Mutual follow friends" },
  { value: "FOLLOWER_OF_CREATOR", label: "Follower of creator" },
  { value: "SELF_ONLY", label: "Self only" },
];

/** Video containers TikTok's Direct Post API accepts. */
const TIKTOK_VIDEO_EXTS = ["mp4", "webm", "mov"];
/** Known video containers TikTok does NOT support (mkv, avi, m4v, …). */
const OTHER_VIDEO_EXTS = ["mkv", "avi", "m4v", "mpeg", "wmv", "flv"];

function countVideos(media: MediaLike[]): number {
  return media.filter((m) => m.kind === "video").length;
}
function hasVideo(media: MediaLike[]): boolean {
  return countVideos(media) > 0;
}

/**
 * Registry keyed by provider identifier. Anything not present here uses
 * DEFAULT_REQUIREMENT (text post, optional media, no special fields).
 */
const REGISTRY: Record<string, ProviderRequirement> = {
  /* ----------------------------- Media required ---------------------------- */
  tiktok: {
    identifier: "tiktok",
    label: "TikTok",
    maxLength: 2000,
    editor: "normal",
    media: "required",
    mediaNote:
      "TikTok needs one video, one photo, or several photos — it can't be posted without an attachment.",
    fields: [
      {
        key: "title",
        label: "Title (photos only)",
        type: "text",
        maxLength: 90,
        help: "Used as the title when posting photos.",
        showForMedia: "photo",
      },
      {
        // No defaultValue on purpose — TikTok's audit rejects a preselected
        // privacy level. Options are replaced with the creator's own allowed
        // list at render time (see `dynamicOptions`); PRIVACY_LEVELS is only
        // the label source for them.
        key: "privacy_level",
        label: "Who can see this post?",
        type: "select",
        required: true,
        options: PRIVACY_LEVELS,
        dynamicOptions: "tiktok-privacy",
        showForMedia: "attached",
      },
      {
        key: "content_posting_method",
        label: "Content posting method",
        type: "select",
        required: true,
        defaultValue: "DIRECT_POST",
        hidden: true,
      },
      {
        key: "autoAddMusic",
        label: "Auto add music (photos)",
        type: "select",
        required: true,
        defaultValue: "no",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
        showForMedia: "photo",
      },
      {
        key: "comment",
        label: "Allow comments",
        type: "checkbox",
        defaultValue: false,
        dynamicDisabled: "comment",
        showForMedia: "attached",
      },
      {
        key: "duet",
        label: "Allow duet",
        type: "checkbox",
        defaultValue: false,
        dynamicDisabled: "duet",
        showForMedia: "video",
      },
      {
        key: "stitch",
        label: "Allow stitch",
        type: "checkbox",
        defaultValue: false,
        dynamicDisabled: "stitch",
        showForMedia: "video",
      },
      {
        key: "video_made_with_ai",
        label: "AI-generated content",
        type: "checkbox",
        defaultValue: false,
        showForMedia: "video",
      },
      {
        key: "brand_organic_toggle",
        label: "Promotional content",
        type: "checkbox",
        defaultValue: false,
        hidden: true,
      },
      {
        key: "brand_content_toggle",
        label: "Paid partnership",
        type: "checkbox",
        defaultValue: false,
        hidden: true,
      },
    ],
    validate: ({ media, settings, maxVideoDurationSeconds }) => {
      const problems: string[] = [];
      if (media.length === 0) {
        problems.push("Add a video or at least one photo — TikTok can't post without media.");
        return problems;
      }
      // Explicit format restriction (mirrors the backend checkValidity):
      // TikTok accepts mp4/webm/mov video containers; a known-but-unsupported
      // container (mkv, avi, …) would otherwise be silently misclassified.
      const unsupportedVideo = media.find(
        (item) =>
          item.kind === "video" && item.ext && OTHER_VIDEO_EXTS.includes(item.ext),
      );
      if (unsupportedVideo) {
        problems.push(
          "TikTok supports video in MP4, WebM or MOV format only.",
        );
      }
      if (countVideos(media) >= 1 && media.length !== 1) {
        problems.push(
          "A video post can only contain one media item — use photos only when selecting multiple items.",
        );
      }
      const videoDuration = media.find((item) => item.kind === "video")?.durationSeconds;
      if (
        videoDuration !== undefined &&
        maxVideoDurationSeconds &&
        videoDuration > maxVideoDurationSeconds
      ) {
        problems.push(
          `This video is ${Math.ceil(videoDuration)} seconds long. This TikTok account allows videos up to ${maxVideoDurationSeconds} seconds.`,
        );
      }
      // TikTok content-sharing rules, enforced here because the audit checks
      // the composer: the creator must pick a privacy level themselves, and
      // commercial content can never be private.
      const privacy = settings.privacy_level;
      if (!privacy) {
        problems.push("Choose who can see this post on TikTok.");
      }
      const disclosureEnabled = Boolean(settings.commercial_content);
      const commercial =
        Boolean(settings.brand_content_toggle) ||
        Boolean(settings.brand_organic_toggle);
      if (disclosureEnabled && !commercial) {
        problems.push("Choose the applicable content disclosure before posting to TikTok.");
      }
      // TikTok: only Branded content (third party) is incompatible with Self
      // only visibility; promoting your own brand privately is allowed.
      if (Boolean(settings.brand_content_toggle) && privacy === "SELF_ONLY") {
        problems.push(
          "Branded content can't be published with Self only visibility. Choose a wider audience or turn Branded content off.",
        );
      }
      return problems;
    },
  },

  youtube: {
    identifier: "youtube",
    label: "YouTube",
    maxLength: 5000,
    editor: "normal",
    media: "required",
    mediaNote: "YouTube must have exactly one video attachment.",
    fields: [
      {
        key: "title",
        label: "Video title",
        type: "text",
        required: true,
        maxLength: 100,
        placeholder: "My awesome video",
        help: "Required, 2–100 characters.",
      },
      {
        key: "type",
        label: "Visibility",
        type: "select",
        required: true,
        defaultValue: "public",
        options: [
          { value: "public", label: "Public" },
          { value: "unlisted", label: "Unlisted" },
          { value: "private", label: "Private" },
        ],
      },
      {
        key: "selfDeclaredMadeForKids",
        label: "Made for kids",
        type: "select",
        defaultValue: "no",
        options: [
          { value: "no", label: "No" },
          { value: "yes", label: "Yes" },
        ],
      },
      { key: "tags", label: "Tags", type: "tags", help: "Max 500 characters total." },
    ],
    validate: ({ media, settings }) => {
      const problems: string[] = [];
      if (media.length !== 1) {
        problems.push("YouTube needs exactly one media item.");
      } else if (media[0].kind !== "video") {
        problems.push("The attachment must be a video.");
      }
      const title = String(settings.title ?? "");
      if (title.trim().length < 2) problems.push("A video title (min 2 characters) is required.");
      return problems;
    },
  },

  instagram: {
    identifier: "instagram",
    label: "Instagram",
    maxLength: 2200,
    editor: "normal",
    media: "required",
    mediaNote:
      "Instagram needs at least one photo or video. A carousel supports up to 10 items.",
    fields: [
      {
        key: "post_type",
        label: "Post type",
        type: "select",
        required: true,
        defaultValue: "post",
        options: [
          { value: "post", label: "Feed post" },
          { value: "story", label: "Story" },
        ],
      },
      { key: "is_trial_reel", label: "Trial reel", type: "checkbox", defaultValue: false },
    ],
    validate: ({ media, settings }) => {
      const problems: string[] = [];
      if (media.length === 0) {
        problems.push("Instagram needs at least one photo or video.");
        return problems;
      }
      if (media.length > 10) {
        problems.push("An Instagram carousel supports up to 10 items.");
      }
      if (settings.is_trial_reel) {
        if (media.length > 1) problems.push("Trial reels can only have one video.");
        if (!hasVideo(media)) problems.push("Trial reels must be a video.");
      }
      return problems;
    },
  },

  "instagram-standalone": {
    identifier: "instagram-standalone",
    label: "Instagram",
    maxLength: 2200,
    editor: "normal",
    media: "required",
    mediaNote: "Instagram needs at least one photo or video.",
    fields: [
      {
        key: "post_type",
        label: "Post type",
        type: "select",
        required: true,
        defaultValue: "post",
        options: [
          { value: "post", label: "Feed post" },
          { value: "story", label: "Story" },
        ],
      },
      { key: "is_trial_reel", label: "Trial reel", type: "checkbox", defaultValue: false },
    ],
    validate: ({ media, settings }) => {
      const problems: string[] = [];
      if (media.length === 0) {
        problems.push("Instagram needs at least one photo or video.");
        return problems;
      }
      if (settings.is_trial_reel) {
        if (media.length > 1) problems.push("Trial reels can only have one video.");
        if (!hasVideo(media)) problems.push("Trial reels must be a video.");
      }
      return problems;
    },
  },

  pinterest: {
    identifier: "pinterest",
    label: "Pinterest",
    maxLength: 500,
    editor: "normal",
    media: "required",
    mediaNote:
      "Pinterest needs at least one media item (max 5 photos). For a video, add a cover image as the second item.",
    fields: [
      {
        key: "board",
        label: "Board",
        type: "remote-select",
        required: true,
        remoteFn: "boards",
        help: "Choose the board to pin to.",
      },
      { key: "title", label: "Title", type: "text", maxLength: 100 },
      { key: "link", label: "Destination link", type: "url" },
    ],
    validate: ({ media, settings }) => {
      const problems: string[] = [];
      if (media.length === 0) {
        problems.push("Pinterest requires at least one media item.");
      } else if (media.length > 5) {
        problems.push("You can only have up to 5 media items.");
      } else if (hasVideo(media) && media.length !== 2) {
        problems.push("Posting a video requires exactly two items: the video and a cover image.");
      }
      if (!String(settings.board ?? "").trim()) {
        problems.push("A board is required.");
      }
      return problems;
    },
  },

  dribbble: {
    identifier: "dribbble",
    label: "Dribbble",
    maxLength: 40000,
    editor: "normal",
    media: "required",
    mediaNote: "Dribbble needs exactly one image (400x300 or 800x600 px). Videos aren't supported.",
    fields: [
      { key: "title", label: "Title", type: "text", required: true, placeholder: "Shot title" },
      { key: "team", label: "Team URL", type: "url" },
    ],
    validate: ({ media, settings }) => {
      const problems: string[] = [];
      if (media.length !== 1) {
        problems.push("Dribbble needs exactly one image.");
      } else if (media[0].kind === "video") {
        problems.push("Dribbble does not support videos.");
      }
      if (!String(settings.title ?? "").trim()) problems.push("A title is required.");
      return problems;
    },
  },

  /* ----------------------------- Media optional ---------------------------- */
  bluesky: {
    identifier: "bluesky",
    label: "Bluesky",
    maxLength: 300,
    editor: "normal",
    media: "optional",
    mediaNote: "Bluesky allows up to 1 video or 4 photos. It can also be text-only.",
    fields: [],
    validate: ({ media }) => {
      const problems: string[] = [];
      if (hasVideo(media) && media.length > 1) {
        problems.push("You can only upload one video per post.");
      }
      if (!hasVideo(media) && media.length > 4) {
        problems.push("There can be a maximum of 4 photos in a post.");
      }
      return problems;
    },
  },

  facebook: {
    identifier: "facebook",
    label: "Facebook",
    maxLength: 63206,
    editor: "normal",
    media: "optional",
    mediaNote: "Facebook can be text-only, or include photos / a video. Stories need an attachment.",
    fields: [
      {
        key: "post_type",
        label: "Post type",
        type: "select",
        defaultValue: "post",
        options: [
          { value: "post", label: "Feed post" },
          { value: "story", label: "Story" },
        ],
      },
    ],
    validate: ({ media, settings }) => {
      const problems: string[] = [];
      if (settings.post_type === "story" && media.length === 0) {
        problems.push("A Facebook story needs at least one attachment.");
      }
      return problems;
    },
  },

  linkedin: {
    identifier: "linkedin",
    label: "LinkedIn",
    maxLength: 3000,
    editor: "normal",
    media: "optional",
    mediaNote:
      "LinkedIn allows one video, or a carousel of 2+ photos (no video). Comments can only contain text.",
    fields: [
      {
        key: "post_as_images_carousel",
        label: "Post images as a carousel",
        type: "checkbox",
        defaultValue: false,
      },
      {
        key: "carousel_name",
        label: "Carousel name",
        type: "text",
        showIf: (s) => !!s.post_as_images_carousel,
      },
    ],
    validate: ({ media, settings, commentsHaveMedia }) => {
      const problems: string[] = [];
      if (settings.post_as_images_carousel && (media.length < 2 || hasVideo(media))) {
        problems.push("A carousel needs 2 or more photos and no videos.");
      }
      if (media.length > 1 && hasVideo(media)) {
        problems.push("LinkedIn allows a maximum of 1 item when posting a video.");
      }
      if (commentsHaveMedia) {
        problems.push("LinkedIn comments can only contain text.");
      }
      return problems;
    },
  },

  "linkedin-page": {
    identifier: "linkedin-page",
    label: "LinkedIn Page",
    maxLength: 3000,
    editor: "normal",
    media: "optional",
    mediaNote:
      "LinkedIn allows one video, or a carousel of 2+ photos (no video). Comments can only contain text.",
    fields: [
      {
        key: "post_as_images_carousel",
        label: "Post images as a carousel",
        type: "checkbox",
        defaultValue: false,
      },
      {
        key: "carousel_name",
        label: "Carousel name",
        type: "text",
        showIf: (s) => !!s.post_as_images_carousel,
      },
    ],
    validate: ({ media, settings, commentsHaveMedia }) => {
      const problems: string[] = [];
      if (settings.post_as_images_carousel && (media.length < 2 || hasVideo(media))) {
        problems.push("A carousel needs 2 or more photos and no videos.");
      }
      if (media.length > 1 && hasVideo(media)) {
        problems.push("LinkedIn allows a maximum of 1 item when posting a video.");
      }
      if (commentsHaveMedia) {
        problems.push("LinkedIn comments can only contain text.");
      }
      return problems;
    },
  },

  x: {
    identifier: "x",
    label: "X",
    maxLength: 280,
    maxLengthFor: ({ verified }) => (verified ? 4000 : 280),
    editor: "normal",
    media: "optional",
    mediaNote: "X allows up to 4 photos or one video. It can also be text-only.",
    fields: [
      {
        key: "who_can_reply_post",
        label: "Who can reply",
        type: "select",
        required: true,
        defaultValue: "everyone",
        options: [
          { value: "everyone", label: "Everyone" },
          { value: "following", label: "Accounts you follow" },
          { value: "mentionedUsers", label: "Only mentioned users" },
          { value: "subscribers", label: "Subscribers" },
          { value: "verified", label: "Verified accounts" },
        ],
      },
      {
        key: "community",
        label: "Community URL",
        type: "url",
        placeholder: "https://x.com/i/communities/...",
      },
      { key: "made_with_ai", label: "Made with AI", type: "checkbox", defaultValue: false },
      {
        key: "paid_partnership",
        label: "Paid partnership",
        type: "checkbox",
        defaultValue: false,
      },
    ],
    validate: ({ media }) => {
      const problems: string[] = [];
      if (hasVideo(media) && media.length > 1) {
        problems.push("X allows only one video per post.");
      }
      if (!hasVideo(media) && media.length > 4) {
        problems.push("X allows a maximum of 4 photos.");
      }
      return problems;
    },
  },

  gmb: {
    identifier: "gmb",
    label: "Google My Business",
    maxLength: 1500,
    editor: "normal",
    media: "optional",
    mediaNote: "Google My Business can be text-only or include one image. Videos aren't supported.",
    fields: [
      {
        key: "topicType",
        label: "Post type",
        type: "select",
        defaultValue: "STANDARD",
        options: [
          { value: "STANDARD", label: "Standard update" },
          { value: "EVENT", label: "Event" },
          { value: "OFFER", label: "Offer" },
        ],
      },
      {
        key: "eventTitle",
        label: "Event title",
        type: "text",
        showIf: (s) => s.topicType === "EVENT",
        help: "Required for event posts.",
      },
      {
        key: "callToActionType",
        label: "Call to action",
        type: "select",
        defaultValue: "NONE",
        options: [
          { value: "NONE", label: "None" },
          { value: "BOOK", label: "Book" },
          { value: "ORDER", label: "Order" },
          { value: "SHOP", label: "Shop" },
          { value: "LEARN_MORE", label: "Learn more" },
          { value: "SIGN_UP", label: "Sign up" },
          { value: "GET_OFFER", label: "Get offer" },
          { value: "CALL", label: "Call" },
        ],
      },
      {
        key: "callToActionUrl",
        label: "Call to action URL",
        type: "url",
        showIf: (s) => !!s.callToActionType && s.callToActionType !== "NONE" && s.callToActionType !== "CALL",
      },
    ],
    validate: ({ media, settings }) => {
      const problems: string[] = [];
      if (media.length > 1) problems.push("Google My Business posts can only have one image.");
      if (hasVideo(media)) problems.push("Google My Business posts don't support videos.");
      if (settings.topicType === "EVENT" && !String(settings.eventTitle ?? "").trim()) {
        problems.push("Event posts require an event title.");
      }
      return problems;
    },
  },

  lemmy: {
    identifier: "lemmy",
    label: "Lemmy",
    maxLength: 10000,
    editor: "normal",
    media: "optional",
    mediaNote: "Pick at least one community. Only one cover image is allowed.",
    fields: [
      {
        key: "subreddit",
        label: "Communities",
        type: "remote-select",
        required: true,
        remoteFn: "subreddits",
        help: "Choose at least one community to post to.",
      },
    ],
    validate: ({ settings }) => {
      const problems: string[] = [];
      const subs = settings.subreddit;
      if (!Array.isArray(subs) || subs.length === 0) {
        problems.push("Pick at least one community.");
      }
      return problems;
    },
  },

  wrapcast: {
    identifier: "wrapcast",
    label: "Farcaster",
    maxLength: 800,
    editor: "normal",
    media: "optional",
    mediaNote: "Farcaster only accepts photos (no video).",
    fields: [],
    validate: ({ media }) => {
      const problems: string[] = [];
      if (hasVideo(media)) problems.push("Farcaster can only accept images.");
      return problems;
    },
  },

  twitch: {
    identifier: "twitch",
    label: "Twitch",
    maxLength: 500,
    editor: "normal",
    media: "none",
    fields: [
      {
        key: "messageType",
        label: "Message type",
        type: "select",
        defaultValue: "message",
        options: [
          { value: "message", label: "Chat message" },
          { value: "announcement", label: "Announcement" },
        ],
      },
      {
        key: "announcementColor",
        label: "Announcement color",
        type: "select",
        defaultValue: "primary",
        showIf: (s) => s.messageType === "announcement",
        options: [
          { value: "primary", label: "Primary" },
          { value: "blue", label: "Blue" },
          { value: "green", label: "Green" },
          { value: "orange", label: "Orange" },
          { value: "purple", label: "Purple" },
        ],
      },
    ],
    validate: () => [],
  },

  /* --------------------------- Chat / sub-target --------------------------- */
  discord: {
    identifier: "discord",
    label: "Discord",
    maxLength: 1980,
    editor: "markdown",
    media: "optional",
    fields: [
      {
        key: "channel",
        label: "Channel",
        type: "remote-select",
        required: true,
        remoteFn: "channels",
        help: "Choose the server channel to post in.",
      },
    ],
    validate: ({ settings }) => {
      const problems: string[] = [];
      if (!String(settings.channel ?? "").trim()) problems.push("Pick a Discord channel.");
      return problems;
    },
  },

  slack: {
    identifier: "slack",
    label: "Slack",
    maxLength: 400000,
    editor: "normal",
    media: "optional",
    fields: [
      {
        key: "channel",
        label: "Channel",
        type: "remote-select",
        required: true,
        remoteFn: "channels",
        help: "Choose the Slack channel to post in.",
      },
    ],
    validate: ({ settings }) => {
      const problems: string[] = [];
      if (!String(settings.channel ?? "").trim()) problems.push("Pick a Slack channel.");
      return problems;
    },
  },

  whop: {
    identifier: "whop",
    label: "Whop",
    maxLength: 50000,
    editor: "markdown",
    media: "optional",
    fields: [
      {
        key: "company",
        label: "Company",
        type: "remote-select",
        required: true,
        remoteFn: "companies",
      },
      {
        key: "experience",
        label: "Forum",
        type: "remote-select",
        required: true,
        remoteFn: "experiences",
        remoteParam: "company",
        showIf: (s) => !!s.company,
      },
      { key: "title", label: "Title", type: "text" },
    ],
    validate: ({ settings }) => {
      const problems: string[] = [];
      if (!String(settings.company ?? "").trim()) problems.push("Pick a Whop company.");
      if (!String(settings.experience ?? "").trim()) problems.push("Pick a Whop forum.");
      return problems;
    },
  },

  medium: {
    identifier: "medium",
    label: "Medium",
    maxLength: 100000,
    editor: "markdown",
    media: "optional",
    fields: [
      { key: "title", label: "Title", type: "text", required: true },
      { key: "subtitle", label: "Subtitle", type: "text", required: true },
      { key: "canonical", label: "Canonical URL", type: "url" },
      { key: "tags", label: "Tags", type: "tags", help: "Up to 4 tags." },
    ],
    validate: ({ settings }) => {
      const problems: string[] = [];
      if (String(settings.title ?? "").trim().length < 2) problems.push("A title (min 2 chars) is required.");
      if (String(settings.subtitle ?? "").trim().length < 2) problems.push("A subtitle (min 2 chars) is required.");
      return problems;
    },
  },

  devto: {
    identifier: "devto",
    label: "Dev.to",
    maxLength: 100000,
    editor: "markdown",
    media: "optional",
    fields: [
      { key: "title", label: "Title", type: "text", required: true },
      { key: "canonical", label: "Canonical URL", type: "url" },
      { key: "tags", label: "Tags", type: "tags", help: "Up to 4 tags." },
    ],
    validate: ({ settings }) => {
      const problems: string[] = [];
      if (String(settings.title ?? "").trim().length < 2) problems.push("A title (min 2 chars) is required.");
      return problems;
    },
  },

  hashnode: {
    identifier: "hashnode",
    label: "Hashnode",
    maxLength: 10000,
    editor: "markdown",
    media: "optional",
    fields: [
      { key: "title", label: "Title", type: "text", required: true, help: "Min 6 characters." },
      { key: "subtitle", label: "Subtitle", type: "text" },
      {
        key: "publication",
        label: "Publication",
        type: "remote-select",
        required: true,
        remoteFn: "publications",
      },
      { key: "canonical", label: "Canonical URL", type: "url" },
      { key: "tags", label: "Tags", type: "tags", required: true, help: "At least one tag." },
    ],
    validate: ({ settings }) => {
      const problems: string[] = [];
      if (String(settings.title ?? "").trim().length < 6) problems.push("A title (min 6 chars) is required.");
      if (!String(settings.publication ?? "").trim()) problems.push("A publication is required.");
      const tags = settings.tags;
      if (!Array.isArray(tags) || tags.length === 0) problems.push("At least one tag is required.");
      return problems;
    },
  },

  wordpress: {
    identifier: "wordpress",
    label: "WordPress",
    maxLength: 100000,
    editor: "html",
    media: "optional",
    fields: [
      { key: "title", label: "Title", type: "text", required: true, help: "Min 2 characters." },
      {
        key: "type",
        label: "Post type",
        type: "remote-select",
        required: true,
        remoteFn: "postTypes",
      },
    ],
    validate: ({ settings }) => {
      const problems: string[] = [];
      if (String(settings.title ?? "").trim().length < 2) problems.push("A title (min 2 chars) is required.");
      if (!String(settings.type ?? "").trim()) problems.push("A post type is required.");
      return problems;
    },
  },

  ghost: {
    identifier: "ghost",
    label: "Ghost",
    maxLength: 1000000,
    editor: "html",
    media: "optional",
    fields: [
      { key: "title", label: "Title", type: "text", required: true, help: "Min 2 characters." },
      { key: "excerpt", label: "Excerpt", type: "textarea" },
      { key: "canonical", label: "Canonical URL", type: "url" },
      { key: "tags", label: "Tags", type: "tags" },
      { key: "publish", label: "Publish immediately", type: "checkbox", defaultValue: true },
    ],
    validate: ({ settings }) => {
      const problems: string[] = [];
      if (String(settings.title ?? "").trim().length < 2) problems.push("A title (min 2 chars) is required.");
      return problems;
    },
  },

  notion: {
    identifier: "notion",
    label: "Notion",
    maxLength: 100000,
    editor: "markdown",
    media: "optional",
    fields: [
      { key: "title", label: "Page title", type: "text", required: true },
      {
        key: "database",
        label: "Database",
        type: "remote-select",
        required: true,
        remoteFn: "databases",
      },
      {
        key: "titleProperty",
        label: "Title property name",
        type: "text",
        defaultValue: "Name",
        help: "Defaults to \"Name\".",
      },
    ],
    validate: ({ settings }) => {
      const problems: string[] = [];
      if (!String(settings.title ?? "").trim()) problems.push("A page title is required.");
      if (!String(settings.database ?? "").trim()) problems.push("A database is required.");
      return problems;
    },
  },

  mataroa: {
    identifier: "mataroa",
    label: "Mataroa",
    maxLength: 100000,
    editor: "markdown",
    media: "optional",
    fields: [
      { key: "title", label: "Title", type: "text", required: true },
      { key: "published", label: "Publish immediately", type: "checkbox", defaultValue: true },
    ],
    validate: ({ settings }) => {
      const problems: string[] = [];
      if (!String(settings.title ?? "").trim()) problems.push("A title is required.");
      return problems;
    },
  },

  writeas: {
    identifier: "writeas",
    label: "Write.as",
    maxLength: 100000,
    editor: "markdown",
    media: "optional",
    fields: [
      { key: "title", label: "Title", type: "text" },
      { key: "collection", label: "Collection (blog) alias", type: "text" },
      {
        key: "font",
        label: "Font",
        type: "select",
        defaultValue: "normal",
        options: [
          { value: "normal", label: "Normal" },
          { value: "serif", label: "Serif" },
          { value: "sans", label: "Sans" },
          { value: "wrap", label: "Wrap" },
          { value: "mono", label: "Mono" },
          { value: "code", label: "Code" },
        ],
      },
    ],
    validate: () => [],
  },

  listmonk: {
    identifier: "listmonk",
    label: "Listmonk",
    maxLength: 100000000,
    editor: "html",
    media: "optional",
    mediaNote: "Listmonk sends a newsletter campaign to a mailing list.",
    fields: [
      { key: "subject", label: "Subject", type: "text", required: true },
      { key: "preview", label: "Preview text", type: "text", required: true },
      {
        key: "list",
        label: "Mailing list",
        type: "remote-select",
        required: true,
        remoteFn: "list",
      },
      {
        key: "template",
        label: "Template",
        type: "remote-select",
        remoteFn: "templates",
      },
    ],
    validate: ({ settings }) => {
      const problems: string[] = [];
      if (!String(settings.subject ?? "").trim()) problems.push("A subject is required.");
      if (!String(settings.list ?? "").trim()) problems.push("A mailing list is required.");
      return problems;
    },
  },

  moltbook: {
    identifier: "moltbook",
    label: "Moltbook",
    maxLength: 300,
    editor: "normal",
    media: "optional",
    fields: [],
    validate: () => [],
  },

  /* --------------------- Microblog / chat with media limits ---------------- */
  threads: {
    identifier: "threads",
    label: "Threads",
    maxLength: 500,
    editor: "normal",
    media: "optional",
    mediaNote: "Threads allows up to 10 photos or one video. It can also be text-only.",
    fields: [],
    validate: ({ media }) => {
      const problems: string[] = [];
      if (countVideos(media) > 1) problems.push("Threads allows only one video per post.");
      if (countVideos(media) >= 1 && media.length > 1) {
        problems.push("Threads can't mix a video with other media.");
      }
      if (!hasVideo(media) && media.length > 10) {
        problems.push("Threads allows a maximum of 10 photos.");
      }
      return problems;
    },
  },

  mastodon: {
    identifier: "mastodon",
    label: "Mastodon",
    maxLength: 500,
    editor: "normal",
    media: "optional",
    mediaNote: "Mastodon allows up to 4 photos or one video (can't mix the two).",
    fields: [],
    validate: ({ media }) => {
      const problems: string[] = [];
      if (countVideos(media) >= 1 && media.length > 1) {
        problems.push("Mastodon can't mix a video with photos. Post one video on its own.");
      }
      if (!hasVideo(media) && media.length > 4) {
        problems.push("Mastodon allows a maximum of 4 photos.");
      }
      return problems;
    },
  },

  "mastodon-custom": {
    identifier: "mastodon-custom",
    label: "Mastodon",
    maxLength: 500,
    editor: "normal",
    media: "optional",
    mediaNote: "Mastodon allows up to 4 photos or one video (can't mix the two).",
    fields: [],
    validate: ({ media }) => {
      const problems: string[] = [];
      if (countVideos(media) >= 1 && media.length > 1) {
        problems.push("Mastodon can't mix a video with photos. Post one video on its own.");
      }
      if (!hasVideo(media) && media.length > 4) {
        problems.push("Mastodon allows a maximum of 4 photos.");
      }
      return problems;
    },
  },

  telegram: {
    identifier: "telegram",
    label: "Telegram",
    maxLength: 4096,
    editor: "html",
    media: "optional",
    mediaNote: "Telegram allows up to 10 photos/videos per message. With media, the caption is limited to 1024 characters.",
    fields: [],
    validate: ({ media, body }) => {
      const problems: string[] = [];
      if (media.length > 10) problems.push("Telegram allows a maximum of 10 media items per message.");
      if (media.length > 0 && body.length > 1024) {
        problems.push("With media attached, Telegram limits the caption to 1024 characters.");
      }
      return problems;
    },
  },

};

/**
 * TikTok UX rule (Content Sharing Guidelines, point 3a): when the Content
 * Disclosure toggle is ON but neither "Your brand" nor "Branded content" is
 * chosen, the publish button must be disabled (not just warned).
 */
export function tiktokDisclosureBlocksPublish(
  settings: Record<string, unknown>,
): boolean {
  const commercial =
    Boolean(settings.brand_content_toggle) ||
    Boolean(settings.brand_organic_toggle);
  const disclosure = Boolean(settings.commercial_content) || commercial;
  return disclosure && !commercial;
}

/** Providers with no special settings: text post, optional media, max lengths. */
const SIMPLE_TEXT: Record<string, { label: string; maxLength: number; editor: ProviderRequirement["editor"] }> = {
  nostr: { label: "Nostr", maxLength: 100000, editor: "normal" },
  blogger: { label: "Blogger", maxLength: 500000, editor: "html" },
};

export const DEFAULT_REQUIREMENT: Omit<ProviderRequirement, "identifier" | "label"> = {
  maxLength: 5000,
  editor: "normal",
  media: "optional",
  fields: [],
  validate: () => [],
};

/**
 * Resolve the requirement for a provider identifier. Falls back to a simple
 * text-post requirement so unknown / not-yet-mapped providers still work.
 */
export function getProviderRequirement(identifier?: string): ProviderRequirement {
  if (identifier && REGISTRY[identifier]) return REGISTRY[identifier];
  if (identifier && SIMPLE_TEXT[identifier]) {
    const s = SIMPLE_TEXT[identifier];
    return {
      identifier,
      label: s.label,
      maxLength: s.maxLength,
      editor: s.editor,
      media: "optional",
      fields: [],
      validate: () => [],
    };
  }
  return {
    identifier: identifier ?? "unknown",
    label: identifier ?? "Channel",
    ...DEFAULT_REQUIREMENT,
  };
}

/**
 * Map a UI platform label (e.g. "TikTok") to a best-guess provider identifier,
 * for channels that don't carry the backend identifier (demo data).
 */
export function identifierFromPlatform(platform: string): string | undefined {
  const map: Record<string, string> = {
    YouTube: "youtube",
    Facebook: "facebook",
    LinkedIn: "linkedin",
    X: "x",
    TikTok: "tiktok",
    Instagram: "instagram",
    Threads: "threads",
    Pinterest: "pinterest",
    Discord: "discord",
    Slack: "slack",
    Telegram: "telegram",
    Twitch: "twitch",
    Bluesky: "bluesky",
    Mastodon: "mastodon",
  };
  return map[platform];
}

/** Build the default settings object for a provider from its field defaults. */
export function defaultSettingsFor(identifier?: string): Record<string, unknown> {
  const req = getProviderRequirement(identifier);
  const out: Record<string, unknown> = {};
  for (const f of req.fields) {
    if (f.defaultValue !== undefined) out[f.key] = f.defaultValue;
  }
  return out;
}

/** Seconds-saving helper: does this provider need media at all? */
export function providerRequiresMedia(identifier?: string): boolean {
  return getProviderRequirement(identifier).media === "required";
}

/** Resolve the effective max post length for a provider + account context. */
export function effectiveMaxLength(
  req: ProviderRequirement,
  ctx: { verified?: boolean },
): number {
  return req.maxLengthFor ? req.maxLengthFor(ctx) : req.maxLength;
}
