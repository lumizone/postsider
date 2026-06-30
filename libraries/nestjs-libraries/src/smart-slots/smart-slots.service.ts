import { Injectable } from '@nestjs/common';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { scoreSlots, RankedSlot } from './smart-slots.scoring';

// A fairly dense candidate grid so the gradient heuristic + diversifier have room
// to find good, spread-out slots (not just a handful of fixed hours).
const CANDIDATE_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
const DAYS_AHEAD = 14;
const LEAD_MS = 30 * 60_000; // never suggest a slot less than 30 min out
const COLLISION_MS = 45 * 60_000; // keep suggestions clear of already-queued posts
const HISTORY_DAYS = 90;
const MIN_HISTORY = 8; // need a real signal before personalizing
const SPREAD_MS = 3 * 3_600_000; // suggestions at least 3h apart
const DAY_MS = 86_400_000;

@Injectable()
export class SmartSlotsService {
  constructor(private _prisma: PrismaService) {}

  /**
   * Suggest the best future posting times for a channel.
   *
   * Ranking blends three real signals:
   *  1. a per-platform, audience-local peak-hour heuristic (smart-slots.heuristics),
   *  2. the channel's OWN posting rhythm — a histogram of the hours its past
   *     PUBLISHED posts went out (only when there are enough to be meaningful),
   *  3. collision avoidance — candidates within COLLISION_MS of an already-queued
   *     post are dropped so we never suggest a time you're already posting.
   * Results are diversified (at most one per local day, ≥3h apart) so you get a
   * spread of options instead of a cluster.
   *
   * tzOffsetMinutes = minutes to ADD to UTC to reach the audience-local wall clock.
   * NOTE: engagement-based optimization would require persisting post analytics
   * over time; the clickHistogram path is ready for that when it exists.
   */
  async suggest(
    orgId: string,
    integrationId: string,
    platform: string,
    count = 3,
    tzOffsetMinutes = 0,
  ): Promise<{ datetime: string; score: number }[]> {
    const offsetMs = tzOffsetMinutes * 60_000;
    const nowMs = Date.now();
    const localNow = new Date(nowMs + offsetMs);

    // 1) Candidate grid in audience-local time, future-only (with a small lead).
    const candidates: Date[] = [];
    for (let d = 0; d < DAYS_AHEAD; d++) {
      for (const h of CANDIDATE_HOURS) {
        const localMs = Date.UTC(
          localNow.getUTCFullYear(),
          localNow.getUTCMonth(),
          localNow.getUTCDate() + d,
          h,
          0,
          0,
          0,
        );
        const utcMs = localMs - offsetMs;
        if (utcMs > nowMs + LEAD_MS) candidates.push(new Date(utcMs));
      }
    }

    // 2) Pull the channel's own posts: queued (for collision avoidance) and
    // recently published (for the posting-rhythm histogram). Fail-soft to []
    // so suggestions never break if the query errors.
    const [scheduled, published] = await Promise.all([
      this._prisma.post
        .findMany({
          where: {
            integrationId,
            state: 'QUEUE',
            publishDate: { gte: new Date(nowMs), lte: new Date(nowMs + DAYS_AHEAD * DAY_MS) },
          },
          select: { publishDate: true },
        })
        .catch(() => [] as { publishDate: Date }[]),
      this._prisma.post
        .findMany({
          where: {
            integrationId,
            state: 'PUBLISHED',
            publishDate: { gte: new Date(nowMs - HISTORY_DAYS * DAY_MS) },
          },
          select: { publishDate: true },
          take: 500,
        })
        .catch(() => [] as { publishDate: Date }[]),
    ]);

    const busy = scheduled.map((p) => p.publishDate.getTime());
    const free = candidates.filter(
      (c) => !busy.some((b) => Math.abs(c.getTime() - b) < COLLISION_MS),
    );

    // Posting-rhythm histogram (audience-local hour), only with enough signal.
    let histogram: number[] | null = null;
    if (published.length >= MIN_HISTORY) {
      const h = new Array(24).fill(0);
      for (const p of published) {
        h[new Date(p.publishDate.getTime() + offsetMs).getUTCHours()]++;
      }
      histogram = h;
    }

    // 3) Score every (free) candidate, then diversify down to `count`.
    const pool = free.length >= count ? free : candidates;
    const ranked = scoreSlots(pool, platform, histogram, pool.length, tzOffsetMinutes);
    const picked = this.diversify(ranked, count, offsetMs);

    return picked.map((s) => ({ datetime: s.datetime.toISOString(), score: s.score }));
  }

  /**
   * Greedy spread: take the highest-scored slots, but at most one per local
   * calendar day and never two within SPREAD_MS. If the per-day cap can't fill
   * `count` (e.g. count > distinct days available), relax it in a second pass.
   */
  private diversify(ranked: RankedSlot[], count: number, offsetMs: number): RankedSlot[] {
    const out: RankedSlot[] = [];
    const usedDays = new Set<string>();
    const localDay = (d: Date) => new Date(d.getTime() + offsetMs).toISOString().slice(0, 10);

    for (const enforceOnePerDay of [true, false]) {
      for (const slot of ranked) {
        if (out.length >= count) break;
        if (out.includes(slot)) continue;
        if (out.some((o) => Math.abs(o.datetime.getTime() - slot.datetime.getTime()) < SPREAD_MS)) {
          continue;
        }
        if (enforceOnePerDay && usedDays.has(localDay(slot.datetime))) continue;
        out.push(slot);
        usedDays.add(localDay(slot.datetime));
      }
      if (out.length >= count) break;
    }
    return out.slice(0, count);
  }
}
