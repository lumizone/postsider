import {
  Controller,
  HttpException,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import {
  PolarService,
  WebhookVerificationError,
} from '@postsider/nestjs-libraries/services/polar.service';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

@ApiTags('Polar')
@Controller('/polar')
export class PolarController {
  constructor(private readonly _polarService: PolarService) {}

  @Post('/')
  async webhook(@Req() req: RawBodyRequest<Request>) {
    let event: any;
    try {
      event = this._polarService.validateRequest(
        req.rawBody as Buffer,
        req.headers as Record<string, string>
      );
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        throw new HttpException('Invalid signature', HttpStatus.FORBIDDEN);
      }
      throw new HttpException('Invalid webhook', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this._polarService.handleWebhook(event);
    } catch (e) {
      // Do not leak internal error details back to the webhook caller.
      console.error('Polar webhook handling failed', e);
      throw new HttpException(
        'Webhook handling failed',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
