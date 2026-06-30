import { Injectable } from '@nestjs/common';
import { scoreSlots } from './smart-slots.scoring';

const CANDIDATE_HOURS = [7, 8, 9, 11, 12, 13, 15, 17, 18, 19, 20, 21];
const DAYS_AHEAD = 14;

@Injectable()
export class SmartSlotsService {
  /**
   * Suggest the best future posting times for a platform.
   * Candidate hours are interpreted in the caller's local timezone (tzOffsetMinutes
   * = minutes to add to UTC to get local), so suggestions land at audience-local
   * peak hours. v1: heuristic-only (clickHistogram=null); orgId/integrationId
   * reserved for future per-org click-data refinement.
   */
  async suggest(
    orgId: string, integrationId: string, platform: string, count = 3,
    tzOffsetMinutes = 0,
  ) {
    const offsetMs = tzOffsetMinutes * 60000;
    const nowMs = Date.now();
    // "local now" read via UTC getters gives the local wall clock date.
    const localNow = new Date(nowMs + offsetMs);
    const candidates: Date[] = [];
    for (let d = 0; d < DAYS_AHEAD; d++) {
      for (const h of CANDIDATE_HOURS) {
        // Build the local wall-clock datetime, then convert back to real UTC.
        const localMs = Date.UTC(
          localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate() + d, h, 0, 0, 0,
        );
        const utcMs = localMs - offsetMs;
        if (utcMs > nowMs) candidates.push(new Date(utcMs));
      }
    }
    return scoreSlots(candidates, platform, null, count, tzOffsetMinutes).map((s) => ({
      datetime: s.datetime.toISOString(),
      score: s.score,
    }));
  }
}
