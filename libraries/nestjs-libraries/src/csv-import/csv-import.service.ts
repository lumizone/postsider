import { BadRequestException, Injectable } from '@nestjs/common';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { parseCSV, rowsToRecords } from './csv.parser';
import {
  CsvRowSchema,
  REQUIRED_COLUMNS,
  parseDateTime,
  resolveChannels,
  splitThread,
} from './csv.validator';

export interface CsvImportResult {
  row: number;
  ok: boolean;
  channels?: string;
  scheduledFor?: string;
  created?: number;
  error?: string;
}

@Injectable()
export class CsvImportService {
  constructor(
    private _posts: PostsService,
    private _integrations: IntegrationService
  ) {}

  async importCSV(
    orgId: string,
    buffer: Buffer,
    asDraft = false
  ): Promise<CsvImportResult[]> {
    const rows = parseCSV(buffer.toString('utf-8'));
    const { headers, records } = rowsToRecords(rows);

    if (records.length === 0) {
      throw new BadRequestException('The CSV file has no data rows.');
    }
    const missingCols = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
    if (missingCols.length) {
      throw new BadRequestException(
        `Missing required columns: ${missingCols.join(', ')}.`
      );
    }

    const integrations = (
      await this._integrations.getIntegrationsList(orgId)
    )
      .filter((i: any) => !i.disabled && !i.deletedAt)
      .map((i: any) => ({ id: i.id, name: i.name }));

    const results: CsvImportResult[] = [];

    for (let idx = 0; idx < records.length; idx++) {
      const rowNumber = idx + 2; // +1 header, +1 to 1-base
      try {
        const parsed = CsvRowSchema.safeParse(records[idx]);
        if (!parsed.success) {
          results.push({
            row: rowNumber,
            ok: false,
            error: parsed.error.issues.map((e) => e.message).join('; '),
          });
          continue;
        }
        const data = parsed.data;

        const { matched, missing } = resolveChannels(data.channels, integrations);
        if (missing.length) {
          results.push({
            row: rowNumber,
            ok: false,
            channels: data.channels,
            error: `No connected channel matched: ${missing.join(', ')}`,
          });
          continue;
        }

        // Resolve the schedule datetime. Blank -> next free queue slot for the
        // first matched channel (depends on PostsService.findFreeDateTime).
        let date: string;
        if (data.datetime) {
          const parsedDate = parseDateTime(data.datetime);
          if (!parsedDate) {
            results.push({
              row: rowNumber,
              ok: false,
              error: `Invalid datetime "${data.datetime}" (use YYYY-MM-DD HH:mm, UTC).`,
            });
            continue;
          }
          // CSV datetimes are interpreted as UTC (the public API contract).
          date = parsedDate + 'Z';
          if (new Date(date).getTime() < Date.now()) {
            results.push({
              row: rowNumber,
              ok: false,
              error: `Datetime "${data.datetime}" is in the past (UTC).`,
            });
            continue;
          }
        } else {
          // Next free queue slot (UTC wall-clock); mark it UTC like Evergreen.
          date = (await this._posts.findFreeDateTime(orgId, matched[0].id)) + 'Z';
        }

        const threadParts = splitThread(data.thread);
        const value = [
          { content: data.content, image: [] },
          ...threadParts.map((p) => ({ content: p, image: [] })),
        ];

        const dto: any = {
          // Opt-in: land as DRAFT so the batch can go through the (still
          // fully optional) approval flow instead of publishing unreviewed.
          type: asDraft ? 'draft' : 'schedule',
          shortLink: false,
          date,
          tags: [],
          posts: matched.map((m) => ({
            integration: { id: m.id },
            value,
            settings: {},
            ...(data.first_comment
              ? { firstComment: data.first_comment }
              : {}),
          })),
        };

        const mapped = await this._posts.mapTypeToPost(dto, orgId);
        const created = await this._posts.createPost(orgId, mapped, 'CSV' as any);

        results.push({
          row: rowNumber,
          ok: true,
          channels: matched.map((m) => m.name).join(', '),
          scheduledFor: date,
          created: created?.length ?? 0,
        });
      } catch (err) {
        results.push({
          row: rowNumber,
          ok: false,
          error: err instanceof Error ? err.message : 'Row failed',
        });
      }
    }

    return results;
  }
}
