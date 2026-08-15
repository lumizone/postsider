import { Command } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { AuthService } from '@postsider/helpers/auth/auth.service';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';

/**
 * One-shot bootstrap for self-hosters.
 *
 * `pnpm bootstrap` creates the very first organization and its SUPERADMIN user.
 * It prints one-time credentials for the setup screen. After this, public registration
 * stays disabled (DISABLE_REGISTRATION=true) — additional users join via
 * Settings → Users → Invite from inside the dashboard.
 *
 * Re-running is safe: refuses when any user already exists in the DB.
 *
 * Set BOOTSTRAP_ORGANIZATION to choose the initial organization name.
 */
@Injectable()
export class BootstrapAdminTask {
  constructor(private readonly _prisma: PrismaService) {}

  @Command({
    command: 'bootstrap',
    describe:
      'Create the initial admin user and organization. Optionally reads BOOTSTRAP_ORGANIZATION.',
  })
  async create() {
    const userCount = await this._prisma.user.count();

    if (userCount > 0) {
      console.error(
        '\n  ✖  Refusing to bootstrap: this database already has %d user(s).',
        userCount,
      );
      console.error(
        '     Use Settings → Users in the dashboard to invite more people.\n',
      );
      process.exit(2);
      return;
    }

    console.log('\n  PostSider — first-time bootstrap');
    console.log('  ─────────────────────────────────');

    const org = (process.env.BOOTSTRAP_ORGANIZATION ?? '').trim() || 'PostSider';
    // Generate a random one-time password the operator uses for the first login.
    const setupPassword = makeId(12);

    try {
      // Ensure the local uploads directory exists.
      const fs = await import('fs');
      const path = await import('path');
      const uploadDir = path.resolve(process.env.UPLOAD_DIRECTORY || './uploads');
      fs.mkdirSync(uploadDir, { recursive: true });

      const created = await this._prisma.organization.create({
        data: {
          name: org,
          apiKey: AuthService.fixedEncryption(makeId(20)),
          allowTrial: true,
          isTrailing: true,
          users: {
            create: {
              role: 'SUPERADMIN',
              user: {
                create: {
                  activated: true,
                  // Placeholder email — the operator sets their real one on
                  // the setup screen after first login.
                  email: 'admin@setup.local',
                  password: AuthService.hashPassword(setupPassword),
                  providerName: 'LOCAL',
                  providerId: '',
                  timezone: 0,
                  ip: '127.0.0.1',
                  agent: 'cli/bootstrap',
                  // name is null — frontend uses this as a signal to show
                  // the setup screen instead of the dashboard.
                },
              },
            },
          },
        },
        select: {
          id: true,
        },
      });

      console.log('\n  ✔  Instance bootstrapped.');
      console.log(`     Organization : ${org}`);
      console.log(`     Org ID       : ${created.id}`);
      console.log('');
      console.log('  ┌────────────────────────────────────────┐');
      console.log('  │  First-login credentials               │');
      console.log('  │                                        │');
      console.log(`  │  Email:    admin@setup.local            │`);
      console.log(`  │  Password: ${setupPassword.padEnd(28)}│`);
      console.log('  │                                        │');
      console.log('  │  Open the dashboard and sign in with   │');
      console.log('  │  these credentials. You will be asked  │');
      console.log('  │  to set your real email and password.  │');
      console.log('  └────────────────────────────────────────┘');
      console.log('');

      await this._prisma.$disconnect();
      process.exit(0);
    } catch (err: any) {
      await this._prisma.$disconnect().catch(() => {});
      console.error('\n  ✖  Bootstrap failed:', err?.message ?? String(err));
      process.exit(1);
    }
  }
}
