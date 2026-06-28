import { Global, Module } from '@nestjs/common';
import { PostCheckerService } from './post-checker.service';

// OpenaiService is provided by the global DatabaseModule, so it is injectable
// into PostCheckerService without re-registering it here.
@Global()
@Module({
  providers: [PostCheckerService],
  exports: [PostCheckerService],
})
export class PostCheckerModule {}
