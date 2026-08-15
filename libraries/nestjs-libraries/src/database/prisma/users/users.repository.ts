import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Provider } from '@prisma/client';
import { AuthService } from '@postsider/helpers/auth/auth.service';
import { UserDetailDto } from '@postsider/nestjs-libraries/dtos/users/user.details.dto';
import { EmailNotificationsDto } from '@postsider/nestjs-libraries/dtos/users/email-notifications.dto';

@Injectable()
export class UsersRepository {
  constructor(private _user: PrismaRepository<'user'>) {}

  getImpersonateUser(name: string) {
    return this._user.model.user.findMany({
      where: {
        OR: [
          {
            name: {
              contains: name,
            },
          },
          {
            email: {
              contains: name,
            },
          },
          {
            id: {
              contains: name,
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
      take: 10,
    });
  }

  getUserById(id: string) {
    return this._user.model.user.findFirst({
      where: {
        id,
      },
    });
  }

  getUserByEmail(email: string) {
    return this._user.model.user.findFirst({
      where: {
        email,
        providerName: Provider.LOCAL,
      },
      include: {
        picture: {
          select: {
            id: true,
            path: true,
          },
        },
      },
    });
  }

  activateUser(id: string) {
    return this._user.model.user.update({
      where: {
        id,
      },
      data: {
        activated: true,
      },
    });
  }

  getUserByProvider(providerId: string, provider: Provider) {
    return this._user.model.user.findFirst({
      where: {
        providerId,
        providerName: provider,
      },
    });
  }

  updatePassword(id: string, password: string) {
    return this._user.model.user.update({
      where: {
        id,
        providerName: Provider.LOCAL,
      },
      data: {
        password: AuthService.hashPassword(password),
      },
    });
  }

  setupUser(id: string, data: Record<string, any>) {
    return this._user.model.user.update({
      where: { id },
      data,
    });
  }

  changeAudienceSize(userId: string, audience: number) {
    return this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        audience,
      },
    });
  }

  async getPersonal(userId: string) {
    const user = await this._user.model.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        name: true,
        lastName: true,
        bio: true,
        timezone: true,
        picture: {
          select: {
            id: true,
            path: true,
          },
        },
      },
    });

    return user;
  }

  async changePersonal(userId: string, body: UserDetailDto) {
    const data: Record<string, any> = {};

    // Support both "fullname" (legacy) and "name"/"lastName" (new frontend).
    if (body.fullname) data.name = body.fullname;
    if (body.name !== undefined) data.name = body.name;
    if (body.lastName !== undefined) data.lastName = body.lastName;
    if (body.bio !== undefined) data.bio = body.bio;
    if (body.timezone !== undefined) data.timezone = body.timezone;

    if (body.picture) {
      data.picture = { connect: { id: body.picture.id } };
    } else if (body.picture === null) {
      data.picture = { disconnect: true };
    }

    if (Object.keys(data).length > 0) {
      await this._user.model.user.update({
        where: { id: userId },
        data,
      });
    }
  }

  async getEmailNotifications(userId: string) {
    return this._user.model.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        sendSuccessEmails: true,
        sendFailureEmails: true,
        sendStreakEmails: true,
      },
    });
  }

  async updateEmailNotifications(userId: string, body: EmailNotificationsDto) {
    await this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        sendSuccessEmails: body.sendSuccessEmails,
        sendFailureEmails: body.sendFailureEmails,
        sendStreakEmails: body.sendStreakEmails,
      },
    });
  }
}
