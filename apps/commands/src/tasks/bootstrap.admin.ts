import { Command } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import * as readline from 'readline';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { AuthService } from '@postsider/helpers/auth/auth.service';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';

/**
 * One-shot bootstrap for self-hosters.
 *
 * `pnpm bootstrap` walks the operator through creating the very first
 * organization and its SUPERADMIN user. After this, public registration
 * stays disabled (DISABLE_REGISTRATION=true) — additional users join via
 * Settings → Users → Invite from inside the dashboard.
 *
 * Re-running is safe: refuses when any user already exists in the DB.
 *
 * Non-interactive: set BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD and optionally
 * BOOTSTRAP_ORGANIZATION env vars to skip all prompts. Useful for
 * Dockerfile entrypoints.
 */
@Injectable()
export class BootstrapAdminTask {
  constructor(private readonly _prisma: PrismaService) {}

  @Command({
    command: 'bootstrap',
    describe:
      'Create the initial admin user and organization. Reads BOOTSTRAP_EMAIL / BOOTSTRAP_PASSWORD / BOOTSTRAP_ORGANIZATION env vars; prompts for anything missing.',
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

    const envEmail = ''; // not used — first login sets email
    const envPassword = ''; // generated at bootstrap time
    const envOrg = (process.env.BOOTSTRAP_ORGANIZATION ?? '').trim();

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function prompt(
  question: string,
  defaultValue = '',
  secret = false,
): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const full = `  ${question}${suffix} `;

  return new Promise<string>((resolve) => {
    if (!secret) {
      rl.question(full, (answer: string) => {
        rl.close();
        resolve((answer || defaultValue).trim());
      });
      return;
    }

    // Masked password input.
    process.stdout.write(full);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setEncoding('utf8');
    if (typeof (stdin as any).setRawMode === 'function') {
      (stdin as any).setRawMode(true);
    }
    let input = '';
    const handler = (ch: string) => {
      const code = ch.charCodeAt(0);
      if (ch === '\n' || ch === '\r' || code === 4) {
        if (typeof (stdin as any).setRawMode === 'function') {
          (stdin as any).setRawMode(false);
        }
        stdin.pause();
        stdin.removeListener('data', handler);
        process.stdout.write('\n');
        rl.close();
        resolve((input || defaultValue).trim());
        return;
      }
      if (code === 127 || code === 8) {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      if (code === 3) {
        process.stdout.write('\n');
        process.exit(130);
        return;
      }
      input += ch;
      process.stdout.write('*');
    };
    stdin.on('data', handler);
  });
}
