import { Global, Module } from '@nestjs/common';
import { PostCheckerService } from './post-checker.service';
import { OpenaiCheckProvider } from './providers/openai.check.provider';
import { DeepseekCheckProvider } from './providers/deepseek.check.provider';
import { GeminiCheckProvider } from './providers/gemini.check.provider';

// OpenaiService and ProviderCredentialsService are provided by the global
// DatabaseModule, so they are injectable here without re-registering.
@Global()
@Module({
  providers: [
    PostCheckerService,
    OpenaiCheckProvider,
    DeepseekCheckProvider,
    GeminiCheckProvider,
  ],
  exports: [PostCheckerService],
})
export class PostCheckerModule {}
