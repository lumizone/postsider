import { NestFactory } from '@nestjs/core';
import { CommandService } from 'nestjs-command';
import { BootstrapModule } from './bootstrap.module';

async function run() {
  const app = await NestFactory.createApplicationContext(BootstrapModule, {
    logger: ['error'],
  });

  try {
    await app.select(BootstrapModule).get(CommandService).exec();
    await app.close();
  } catch (error) {
    console.error(error);
    await app.close();
    process.exit(1);
  }
}

run();
