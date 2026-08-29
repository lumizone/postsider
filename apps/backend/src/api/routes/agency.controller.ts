import { Controller, ForbiddenException, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { AgencyOverviewService } from '@postsider/nestjs-libraries/database/prisma/agency/agency-overview.service';
import { CustomerReportService } from '@postsider/nestjs-libraries/database/prisma/agency/customer-report.service';

@ApiTags('Agency')
@Controller('/agency')
export class AgencyController {
  constructor(
    private _overview: AgencyOverviewService,
    private _customerReport: CustomerReportService
  ) {}

  @Get('/overview')
  overview(
    @GetOrgFromRequest() org: Organization,
    @Query('days') days?: string
  ) {
    if (!org.agencyMode) {
      throw new ForbiddenException('Agency mode is disabled');
    }
    const parsed = Number(days);
    return this._overview.getOverview(
      org.id,
      Number.isFinite(parsed) && parsed > 0 ? parsed : 30
    );
  }

  @Get('/customers/:customerId/report')
  report(
    @GetOrgFromRequest() org: Organization,
    @Param('customerId') customerId: string,
    @Query('days') days?: string
  ) {
    if (!org.agencyMode) {
      throw new ForbiddenException('Agency mode is disabled');
    }
    const parsed = Number(days);
    return this._customerReport.getReport(
      org.id,
      customerId,
      Number.isFinite(parsed) && parsed > 0 ? parsed : 30
    );
  }
}
