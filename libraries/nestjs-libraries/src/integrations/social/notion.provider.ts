import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { SocialAbstract } from '@postsider/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { NotionDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/notion.dto';
import { Tool } from '@postsider/nestjs-libraries/integrations/tool.decorator';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

/**
 * Notion integration using an Internal Integration token.
 *
 * Users create an internal integration in https://www.notion.so/profile/integrations
 * and share the target databases with it. The token is used to create new
 * pages inside the chosen database.
 */
export class NotionProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3; // Notion API: ~3 req/s
  identifier = 'notion';
  name = 'Notion';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'markdown' as const;
  dto = NotionDto;

  maxLength() {
    return 100_000;
  }

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url: state,
      codeVerifier: makeId(10),
      state,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async customFields() {
    return [
      {
        key: 'apiKey',
        label: 'Internal Integration Token',
        validation: `/^.{20,}$/`,
        type: 'password' as const,
      },
    ];
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const body = JSON.parse(Buffer.from(params.code, 'base64').toString()) as {
      apiKey: string;
    };

    try {
      const me = await (
        await this.fetch(`${NOTION_API}/users/me`, {
          headers: {
            Authorization: `Bearer ${body.apiKey}`,
            'Notion-Version': NOTION_VERSION,
          },
        })
      ).json();

      const id = me?.id || makeId(12);
      const name =
        me?.bot?.workspace_name || me?.name || 'Notion Workspace';
      const picture = me?.bot?.workspace_icon || me?.avatar_url || '';

      return {
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: body.apiKey,
        id,
        name,
        picture,
        username: name,
      };
    } catch (err) {
      console.log('Notion authenticate error', err);
      return 'Invalid credentials';
    }
  }

  @Tool({ description: 'List shared Notion databases', dataSchema: [] })
  async databases(accessToken: string) {
    const response = await (
      await this.fetch(`${NOTION_API}/search`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': NOTION_VERSION,
        },
        body: JSON.stringify({
          filter: { value: 'database', property: 'object' },
          page_size: 50,
        }),
      })
    ).json();

    return (response.results || []).map((db: any) => ({
      id: db.id,
      name:
        db.title?.[0]?.plain_text ||
        db.title?.[0]?.text?.content ||
        'Untitled database',
    }));
  }

  /**
   * Notion blocks have a 2000 character limit per rich_text item, so the
   * markdown body is split into paragraph blocks of safe length.
   */
  private toBlocks(message: string) {
    const chunkSize = 1900;
    const paragraphs = (message || '').split(/\n{2,}/);
    const blocks: any[] = [];

    for (const paragraph of paragraphs) {
      for (let i = 0; i < paragraph.length; i += chunkSize) {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: { content: paragraph.slice(i, i + chunkSize) },
              },
            ],
          },
        });
      }
    }

    if (!blocks.length) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [] },
      });
    }

    return blocks;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<NotionDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const settings = postDetails?.[0]?.settings || ({} as NotionDto);
    const titleProperty = settings.titleProperty || 'Name';

    const response = await this.fetch(`${NOTION_API}/pages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_VERSION,
      },
      body: JSON.stringify({
        parent: { database_id: settings.database },
        properties: {
          [titleProperty]: {
            title: [{ type: 'text', text: { content: settings.title } }],
          },
        },
        children: this.toBlocks(postDetails[0].message),
      }),
    });

    const data = await response.json();

    return [
      {
        id: postDetails[0].id,
        status: 'completed',
        postId: String(data?.id || ''),
        releaseURL: data?.url || '',
      },
    ];
  }
}
