import { IsIn, IsString, MinLength } from 'class-validator';

export class SaveCheckerConfigDto {
  @IsIn(['openai', 'deepseek', 'gemini'])
  provider: 'openai' | 'deepseek' | 'gemini';

  @IsString()
  @MinLength(1)
  model: string;

  @IsString()
  @MinLength(1)
  apiKey: string;
}
