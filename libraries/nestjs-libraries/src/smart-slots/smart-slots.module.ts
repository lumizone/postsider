import { Global, Module } from '@nestjs/common';
import { SmartSlotsService } from './smart-slots.service';

@Global()
@Module({
  providers: [SmartSlotsService],
  exports: [SmartSlotsService],
})
export class SmartSlotsModule {}
