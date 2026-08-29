import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { integrationSecretsExtension } from '@postsider/nestjs-libraries/database/prisma/integration-secrets.extension';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      ...(process.env.NODE_ENV !== 'production'
        ? {
            log: [
              {
                emit: 'event',
                level: 'query',
              },
            ],
          }
        : {}),
    });

    // Every query in the app runs through the integration-secrets extension:
    // OAuth tokens are encrypted on the way in and decrypted on the way out,
    // including when they arrive nested in `include: { integration: true }`.
    // `$extends` returns a NEW client, so it is returned from the constructor —
    // otherwise half the app would hold the unextended one and write plaintext.
    const extended = this.$extends(integrationSecretsExtension) as any;
    // The extended client does not inherit this class's methods, so Nest's
    // lifecycle hooks are re-attached explicitly.
    extended.onModuleInit = async () => {
      await extended.$connect();
    };
    extended.onModuleDestroy = async () => {
      await extended.$disconnect();
    };
    return extended as PrismaService;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Injectable()
export class PrismaRepository<T extends keyof PrismaService> {
  public model: Pick<PrismaService, T>;
  constructor(private _prismaService: PrismaService) {
    this.model = this._prismaService;
  }
}

@Injectable()
export class PrismaTransaction {
  public model: Pick<PrismaService, '$transaction'>;
  constructor(private _prismaService: PrismaService) {
    this.model = this._prismaService;
  }
}
