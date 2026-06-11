import { RedditSettingsDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/reddit.dto';
import { PinterestSettingsDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/pinterest.dto';
import { YoutubeSettingsDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';
import { TikTokDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/tiktok.dto';
import { XDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/x.dto';
import { LemmySettingsDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/lemmy.dto';
import { DribbbleDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/dribbble.dto';
import { DiscordDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/discord.dto';
import { SlackDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/slack.dto';
import { KickDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/kick.dto';
import { TwitchDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/twitch.dto';
import { InstagramDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/instagram.dto';
import { LinkedinDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/linkedin.dto';
import { IsIn } from 'class-validator';
import { MediumSettingsDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/medium.settings.dto';
import { DevToSettingsDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/dev.to.settings.dto';
import { HashnodeSettingsDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/hashnode.settings.dto';
import { WordpressDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/wordpress.dto';
import { ListmonkDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/listmonk.dto';
import { GmbSettingsDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/gmb.settings.dto';
import { FarcasterDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/farcaster.dto';
import { FacebookDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/facebook.dto';
import { MoltbookDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/moltbook.dto';
import { SkoolDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/skool.dto';
import { WhopDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/whop.dto';
import { MeweDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/mewe.dto';
import { RumbleDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/rumble.dto';
import { GhostDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/ghost.dto';
import { NotionDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/notion.dto';
import { BearBlogDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/bear.blog.dto';
import { MataroaDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/mataroa.dto';
import { WriteAsDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/writeas.dto';
import { GmailDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/gmail.dto';

export type ProviderExtension<T extends string, M> = { __type: T } & M;
export type AllProvidersSettings =
  | ProviderExtension<'reddit', RedditSettingsDto>
  | ProviderExtension<'lemmy', LemmySettingsDto>
  | ProviderExtension<'youtube', YoutubeSettingsDto>
  | ProviderExtension<'pinterest', PinterestSettingsDto>
  | ProviderExtension<'dribbble', DribbbleDto>
  | ProviderExtension<'tiktok', TikTokDto>
  | ProviderExtension<'discord', DiscordDto>
  | ProviderExtension<'slack', SlackDto>
  | ProviderExtension<'kick', KickDto>
  | ProviderExtension<'twitch', TwitchDto>
  | ProviderExtension<'x', XDto>
  | ProviderExtension<'linkedin', LinkedinDto>
  | ProviderExtension<'linkedin-page', LinkedinDto>
  | ProviderExtension<'instagram', InstagramDto>
  | ProviderExtension<'instagram-standalone', InstagramDto>
  | ProviderExtension<'medium', MediumSettingsDto>
  | ProviderExtension<'devto', DevToSettingsDto>
  | ProviderExtension<'hashnode', HashnodeSettingsDto>
  | ProviderExtension<'wordpress', WordpressDto>
  | ProviderExtension<'listmonk', ListmonkDto>
  | ProviderExtension<'gmb', GmbSettingsDto>
  | ProviderExtension<'facebook', FacebookDto>
  | ProviderExtension<'wrapcast', FarcasterDto>
  | ProviderExtension<'threads', None>
  | ProviderExtension<'mastodon', None>
  | ProviderExtension<'bluesky', None>
  | ProviderExtension<'telegram', None>
  | ProviderExtension<'nostr', None>
  | ProviderExtension<'moltbook', MoltbookDto>
  | ProviderExtension<'vk', None>
  | ProviderExtension<'skool', SkoolDto>
  | ProviderExtension<'mewe', MeweDto>
  | ProviderExtension<'whop', WhopDto>
  | ProviderExtension<'rumble', RumbleDto>
  | ProviderExtension<'ghost', GhostDto>
  | ProviderExtension<'notion', NotionDto>
  | ProviderExtension<'bear-blog', BearBlogDto>
  | ProviderExtension<'mataroa', MataroaDto>
  | ProviderExtension<'writeas', WriteAsDto>
  | ProviderExtension<'gmail', GmailDto>;

type None = NonNullable<unknown>;

export const allProviders = (setEmpty?: any) => {
  return [
    { value: RedditSettingsDto, name: 'reddit' },
    { value: LemmySettingsDto, name: 'lemmy' },
    { value: YoutubeSettingsDto, name: 'youtube' },
    { value: PinterestSettingsDto, name: 'pinterest' },
    { value: DribbbleDto, name: 'dribbble' },
    { value: TikTokDto, name: 'tiktok' },
    { value: DiscordDto, name: 'discord' },
    { value: SlackDto, name: 'slack' },
    { value: KickDto, name: 'kick' },
    { value: TwitchDto, name: 'twitch' },
    { value: XDto, name: 'x' },
    { value: LinkedinDto, name: 'linkedin' },
    { value: LinkedinDto, name: 'linkedin-page' },
    { value: InstagramDto, name: 'instagram' },
    { value: InstagramDto, name: 'instagram-standalone' },
    { value: MediumSettingsDto, name: 'medium' },
    { value: DevToSettingsDto, name: 'devto' },
    { value: WordpressDto, name: 'wordpress' },
    { value: HashnodeSettingsDto, name: 'hashnode' },
    { value: ListmonkDto, name: 'listmonk' },
    { value: GmbSettingsDto, name: 'gmb' },
    { value: FarcasterDto, name: 'wrapcast' },
    { value: FacebookDto, name: 'facebook' },
    { value: setEmpty, name: 'threads' },
    { value: setEmpty, name: 'mastodon' },
    { value: setEmpty, name: 'bluesky' },
    { value: setEmpty, name: 'telegram' },
    { value: setEmpty, name: 'nostr' },
    { value: setEmpty, name: 'vk' },
    { value: MoltbookDto, name: 'moltbook' },
    { value: SkoolDto, name: 'skool' },
    { value: WhopDto, name: 'whop' },
    { value: MeweDto, name: 'mewe' },
    { value: RumbleDto, name: 'rumble' },
    { value: GhostDto, name: 'ghost' },
    { value: NotionDto, name: 'notion' },
    { value: BearBlogDto, name: 'bear-blog' },
    { value: MataroaDto, name: 'mataroa' },
    { value: WriteAsDto, name: 'writeas' },
    { value: GmailDto, name: 'gmail' },
  ].filter((f) => f.value);
};

export class EmptySettings {
  @IsIn(allProviders(EmptySettings).map((p) => p.name), {
    message: `"__type" must be ${allProviders(EmptySettings)
      .map((p) => p.name)
      .join(', ')}`,
  })
  __type: string;
}
