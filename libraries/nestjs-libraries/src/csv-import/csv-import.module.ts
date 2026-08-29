import { Global, Module } from '@nestjs/common';
import { CsvImportService } from './csv-import.service';

@Global()
@Module({
  providers: [CsvImportService],
  exports: [CsvImportService],
})
export class CsvImportModule {}
