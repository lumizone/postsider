import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

export interface PostAnalyticsPoint {
  metric: string;
  value: number;
  measuredAt: Date;
}

@Injectable()
export class PostAnalyticsRepository {
  constructor(private _postAnalytics: PrismaRepository<'postAnalytics'>) {}

  async upsertMany(
    organizationId: string,
    postId: string,
    points: PostAnalyticsPoint[],
  ) {
    await Promise.all(
      points.map((point) =>
        this._postAnalytics.model.postAnalytics.upsert({
          where: {
            organizationId_postId_metric_measuredAt: {
              organizationId,
              postId,
              metric: point.metric,
              measuredAt: point.measuredAt,
            },
          },
          create: { organizationId, postId, ...point },
          update: { value: point.value },
        }),
      ),
    );
  }
}
