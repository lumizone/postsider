import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Body of customer (workspace) create and rename. */
export class CustomerNameDto {
  @ApiProperty({ minLength: 1, maxLength: 100, description: 'Customer name, 1 to 100 characters, no control characters.' })
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  @Matches(/^[^\u0000-\u001f\u007f]+$/, {
    message: 'name must not contain control characters',
  })
  name: string;
}
