import { Injectable } from '@nestjs/common';
import { AnalyticsData } from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { PostAnalyticsRepository } from './post-analytics.repository';

@Injectable()
export class PostAnalyticsService {
  constructor(private _repository: PostAnalyticsRepository) {}

  async record(
    organizationId: string,
    postId: string,
    analytics: AnalyticsData[],
  ): Promise<void> {
    const points = analytics.flatMap((series) =>
      series.data.flatMap((point) => {
        const value = Number(point.total);
        const measuredAt = new Date(point.date);
        return Number.isFinite(value) && !Number.isNaN(measuredAt.getTime())
          ? [{ metric: series.label, value, measuredAt }]
          : [];
      }),
    );

    if (points.length > 0) {
      await this._repository.upsertMany(organizationId, postId, points);
    }
  }
}
