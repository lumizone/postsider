import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { Request, Response } from 'express';
import sharp from 'sharp';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@postsider/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { MediaService } from '@postsider/nestjs-libraries/database/prisma/media/media.service';
import { ApiTags } from '@nestjs/swagger';
import handleR2Upload from '@postsider/nestjs-libraries/upload/r2.uploader';
import { FileInterceptor } from '@nestjs/platform-express';
import { uploadInterceptorOptions } from '@postsider/nestjs-libraries/upload/upload.limits';
import { CustomFileValidationPipe } from '@postsider/nestjs-libraries/upload/custom.upload.validation';
import { SubscriptionService } from '@postsider/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { isBillingEnabled } from '@postsider/nestjs-libraries/services/billing.flag';
import { UploadFactory } from '@postsider/nestjs-libraries/upload/upload.factory';
import { SaveMediaInformationDto } from '@postsider/nestjs-libraries/dtos/media/save.media.information.dto';

@ApiTags('Media')
@Controller('/media')
export class MediaController {
  private storage = UploadFactory.createStorage();
  constructor(
    private _mediaService: MediaService,
    private _subscriptionService: SubscriptionService
  ) {}

  /**
   * Reads pixel dimensions from an in-memory upload buffer (multer's default
   * MemoryStorage — no disk round-trip). Images only; returns undefined for
   * anything else or on a decode failure, so a corrupt/unsupported file never
   * blocks the upload itself.
   */
  private async probeImageDimensions(
    file: Express.Multer.File
  ): Promise<{ width?: number; height?: number }> {
    if (!file?.mimetype?.startsWith('image/') || !file.buffer) return {};
    try {
      const { width, height } = await sharp(file.buffer).metadata();
      return { width, height };
    } catch {
      return {};
    }
  }

  @Delete('/:id')
  deleteMedia(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._mediaService.deleteMedia(org.id, id);
  }

  /**
   * Delete all media not referenced by any post. Superadmin-only, mirroring the
   * gating on the storage settings page. Destructive — the UI requires a typed
   * confirmation before calling.
   */
  @Post('/cleanup/unused')
  cleanupUnused(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Not available in managed mode', 403);
    }
    return this._mediaService.deleteUnusedMedia(org.id);
  }

  /** Permanently clear the entire media library. Superadmin-only. */
  @Post('/cleanup/all')
  cleanupAll(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Not available in managed mode', 403);
    }
    return this._mediaService.deleteAllMedia(org.id);
  }

  @Post('/upload-server')
  @UseInterceptors(FileInterceptor('file', uploadInterceptorOptions))
  @UsePipes(new CustomFileValidationPipe())
  async uploadServer(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile() file: Express.Multer.File
  ) {
    const originalName = file?.originalname || '';
    const uploadedFile = await this.storage.uploadFile(file);
    const { width, height } = await this.probeImageDimensions(file);
    return this._mediaService.saveFile(
      org.id,
      uploadedFile.originalname,
      uploadedFile.path,
      originalName,
      uploadedFile.kind,
      file?.size,
      width,
      height
    );
  }

  @Post('/save-media')
  async saveMedia(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body('name') name: string,
    @Body('originalName') originalName: string
  ) {
    if (!name) {
      return false;
    }
    return this._mediaService.saveFile(
      org.id,
      name,
      process.env.CLOUDFLARE_BUCKET_URL + '/' + name,
      originalName || undefined
    );
  }

  @Post('/information')
  saveMediaInformation(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SaveMediaInformationDto
  ) {
    return this._mediaService.saveMediaInformation(org.id, body);
  }

  @Post('/upload-simple')
  @UseInterceptors(FileInterceptor('file', uploadInterceptorOptions))
  @UsePipes(new CustomFileValidationPipe())
  async uploadSimple(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile('file') file: Express.Multer.File,
    @Body('preventSave') preventSave: string = 'false'
  ) {
    const originalName = file.originalname;
    const getFile = await this.storage.uploadFile(file);

    if (preventSave === 'true') {
      const { path } = getFile;
      return { path };
    }

    const { width, height } = await this.probeImageDimensions(file);
    return this._mediaService.saveFile(
      org.id,
      getFile.originalname,
      getFile.path,
      originalName,
      getFile.kind,
      file.size,
      width,
      height
    );
  }

  @Post('/:endpoint')
  async uploadFile(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Res() res: Response,
    @Param('endpoint') endpoint: string
  ) {
    const upload = await handleR2Upload(endpoint, req, res);
    if (endpoint !== 'complete-multipart-upload') {
      return upload;
    }

    // @ts-ignore
    const name = upload.Location.split('/').pop();
    const originalName = req.body?.file?.name;

    const saveFile = await this._mediaService.saveFile(
      org.id,
      name,
      // @ts-ignore
      upload.Location,
      originalName || undefined
    );

    res.status(200).json({ ...upload, saved: saveFile });
  }

  @Get('/')
  getMedia(
    @GetOrgFromRequest() org: Organization,
    @Query('page') page: number,
    @Query('search') search?: string
  ) {
    return this._mediaService.getMedia(org.id, page, search);
  }

}
