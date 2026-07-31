import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { SocialAbstract } from '@postsider/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import axios from 'axios';

const MOLTBOOK_API_BASE = 'https://www.moltbook.com/api/v1';

// axios has no default timeout; a hung Moltbook connection would otherwise
// block a posting worker slot indefinitely.
const moltbookClient = axios.create({
  baseURL: MOLTBOOK_API_BASE,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

export class MoltbookProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 100; // Moltbook: 100 requests/minute
  identifier = 'moltbook';
  name = 'Moltbook';
  isBetweenSteps = false;
  scopes = [] as string[];
  isWeb3 = true;
  editor = 'normal' as const;

  maxLength() {
    return 300;
  }

  async customFields() {
    return [
      {
        key: 'apiKey',
        label: 'API Key',
        validation: `/^.{3,}$/`,
        type: 'password' as const,
      },
    ];
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

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url: state,
      codeVerifier: makeId(10),
      state,
    };
  }

  async registerAgent(name: string, description: string) {
    const response = await moltbookClient.post(
      '/agents/register',
      { name, description },
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (!response.data.success) {
      throw new Error(response.data.error || 'Registration failed');
    }

    return response.data.agent;
  }

  async checkAgentStatus(apiKey: string) {
    const response = await moltbookClient.get('/agents/status', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    return response.data;
  }

  async getAgentProfile(apiKey: string) {
    const response = await moltbookClient.get('/agents/me', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to get profile');
    }

    return response.data.agent;
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    // Support both raw API key (legacy) and base64-encoded JSON from custom fields form
    let apiKey = params.code;
    try {
      const decoded = JSON.parse(Buffer.from(params.code, 'base64').toString());
      if (decoded.apiKey) {
        apiKey = decoded.apiKey;
      }
    } catch {
      // Not base64 JSON — treat as raw API key (legacy flow)
    }

    const profile = await this.getAgentProfile(apiKey);

    return {
      id: profile.name || profile.id,
      name: profile.display_name || profile.name,
      accessToken: apiKey,
      refreshToken: '',
      expiresIn: dayjs().add(200, 'year').unix() - dayjs().unix(),
      picture: '',
      username: profile.name,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];

    for (const post of postDetails) {
      const postData: {
        submolt: string;
        title: string;
        content?: string;
        url?: string;
      } = {
        submolt: post.settings?.submolt || 'general',
        title: post.message.slice(0, 100),
        content: post.message,
      };

      const response = await moltbookClient.post(
        '/posts',
        postData,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to create post');
      }

      const postId = response.data.post.id;
      results.push({
        id: post.id,
        postId: String(postId),
        releaseURL: `https://www.moltbook.com/post/${postId}`,
        status: 'completed',
      });
    }

    return results;
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];

    for (const post of postDetails) {
      const commentData: { content: string; parent_id?: string } = {
        content: post.message,
      };

      if (lastCommentId) {
        commentData.parent_id = lastCommentId;
      }

      const response = await moltbookClient.post(
        `/posts/${postId}/comments`,
        commentData,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to create comment');
      }

      const commentId = response.data.comment.id;
      results.push({
        id: post.id,
        postId: String(commentId),
        releaseURL: `https://www.moltbook.com/post/${postId}`,
        status: 'completed',
      });
    }

    return results;
  }
}
