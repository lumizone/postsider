import { IsBoolean, IsInt, Max, Min } from 'class-validator';

export class EvergreenSettingsDto {
  @IsBoolean()
  enabled: boolean;

  // Server clamps this further (EvergreenService.saveSettings) — this range
  // is just the class-validator sanity gate before it gets there.
  @IsInt()
  @Min(1)
  @Max(365)
  intervalDays: number;

  @IsInt()
  @Min(1)
  @Max(20)
  maxPerRun: number;
}
