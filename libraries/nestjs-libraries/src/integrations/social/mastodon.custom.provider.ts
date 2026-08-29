import {
  ClientInformation,
  PostDetails,
  PostResponse,
} from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { MastodonProvider } from '@postsider/nestjs-libraries/integrations/social/mastodon.provider';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { Integration } from '@prisma/client';
import { AuthService } from '@postsider/helpers/auth/auth.service';
import { ssrfSafeDispatcher } from '@postsider/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';

export class MastodonCustomProvider extends MastodonProvider {
  override identifier = 'mastodon-custom';
  override name = 'M. Instance';
  override maxConcurrentJob = 5; // Custom Mastodon instances typically have generous limits
  editor = 'normal' as const;

  protected override instanceRequestOptions(): RequestInit {
    // @ts-ignore -- undici dispatcher is not in the DOM RequestInit type.
    return { dispatcher: ssrfSafeDispatcher };
  }

  // Every custom instance is bound to its own server; the connect flow stores
  // the {accessToken, instanceUrl, username} payload encrypted in
  // integration.customInstanceDetails. Never post to the global default.
  private resolveInstance(integration?: Integration): string {
    if (integration?.customInstanceDetails) {
      try {
        const parsed = JSON.parse(
          AuthService.decryptSecret(integration.customInstanceDetails)
        );
        if (parsed?.instanceUrl) {
          return parsed.instanceUrl;
        }
      } catch {
        // fall through to the env default below
      }
    }
    return process.env.MASTODON_URL || 'https://mastodon.social';
  }

  async externalUrl(url: string) {
    const form = new FormData();
    form.append('client_name', 'Postsider');
    form.append(
      'redirect_uris',
      `${process.env.FRONTEND_URL}/integrations/social/mastodon`
    );
    form.append('scopes', this.scopes.join(' '));
    form.append('website', process.env.FRONTEND_URL!);
    const { client_id, client_secret, ...all } = await (
      await fetch(url + '/api/v1/apps', {
        method: 'POST',
        body: form,
        // @ts-ignore -- undici dispatcher is not in the DOM RequestInit type.
        dispatcher: ssrfSafeDispatcher,
      })
    ).json();

    return {
      client_id,
      client_secret,
    };
  }
  override async generateAuthUrl(
    refresh?: string,
    external?: ClientInformation
  ) {
    const state = makeId(6);
    // generateUrlDynamic takes (customUrl, state, clientId, url) — the OAuth
    // URL has no refresh parameter, so don't pass a 5th arg (it was dropped).
    const url = this.generateUrlDynamic(
      external?.instanceUrl!,
      state,
      external?.client_id!,
      process.env.FRONTEND_URL!
    );

    return {
      url,
      codeVerifier: makeId(10),
      state,
    };
  }

  override async authenticate(
    params: {
      code: string;
      codeVerifier: string;
      refresh?: string;
    },
    clientInformation?: ClientInformation
  ) {
    return this.dynamicAuthenticate(
      clientInformation?.client_id!,
      clientInformation?.client_secret!,
      clientInformation?.instanceUrl!,
      params.code
    );
  }

  override async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration?: Integration
  ): Promise<PostResponse[]> {
    return this.dynamicPost(
      id,
      accessToken,
      this.resolveInstance(integration),
      postDetails
    );
  }

  override async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    return this.dynamicComment(
      id,
      postId,
      lastCommentId,
      accessToken,
      this.resolveInstance(integration),
      postDetails
    );
  }
}
