import { Controller, ForbiddenException, Get, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ReportService } from '@postsider/nestjs-libraries/database/prisma/report/report.service';
import { ReportPdfService } from '@postsider/backend/services/report.pdf.service';

@ApiTags('Report')
@Controller('/report')
export class ReportController {
  constructor(
    private _report: ReportService,
    private _pdf: ReportPdfService
  ) {}

  @Get('/customers/:customerId/pdf')
  async download(
    @GetOrgFromRequest() org: Organization,
    @Param('customerId') customerId: string,
    @Query('days') days: string | undefined,
    @Res({ passthrough: true }) res: Response
  ) {
    if (!org.agencyMode) {
      throw new ForbiddenException('Agency mode is disabled');
    }
    const parsed = Number(days);
    const data = await this._report.buildReport(
      org.id,
      customerId,
      Number.isFinite(parsed) && parsed > 0 ? parsed : 30
    );
    const bytes = await this._pdf.generate(data);
    const filename =
      `${data.customer.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'client'}-report.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );
    return Buffer.from(bytes);
  }
}
