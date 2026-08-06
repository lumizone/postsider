import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { uploadInterceptorOptions } from '@postsider/nestjs-libraries/upload/upload.limits';
import { SmartSlotsService } from '@postsider/nestjs-libraries/smart-slots/smart-slots.service';
import { CsvImportService } from '@postsider/nestjs-libraries/csv-import/csv-import.service';
import { PostCheckerService, NoCheckerConfigError } from '@postsider/nestjs-libraries/post-checker/post-checker.service';
import { CheckPostDto } from '@postsider/nestjs-libraries/dtos/post-checker/check.post.dto';
import { RewritePostDto } from '@postsider/nestjs-libraries/dtos/post-checker/rewrite.post.dto';
import { COMMENT_PROVIDERS } from '@postsider/nestjs-libraries/integrations/social/comment.capability';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { GetPostsDto } from '@postsider/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetPostsListDto } from '@postsider/nestjs-libraries/dtos/posts/get.posts.list.dto';
import { CheckPolicies } from '@postsider/backend/services/auth/permissions/permissions.ability';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { GetUserFromRequest } from '@postsider/nestjs-libraries/user/user.from.request';
import { ShortLinkService } from '@postsider/nestjs-libraries/short-linking/short.link.service';
import { CreateTagDto } from '@postsider/nestjs-libraries/dtos/posts/create.tag.dto';
import {
  AuthorizationActions,
  Sections,
} from '@postsider/backend/services/auth/permissions/permission.exception.class';
import { PostValidationException } from '@postsider/backend/api/routes/posts.validation.exception';

@ApiTags('Posts')
@Controller('/posts')
export class PostsController {
  constructor(
    private _postsService: PostsService,
    private _shortLinkService: ShortLinkService,
    private _smartSlots: SmartSlotsService,
    private _csvImport: CsvImportService,
    private _postChecker: PostCheckerService
  ) {}

  @Post('/check')
  async checkPost(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CheckPostDto
  ) {
    try {
      return await this._postChecker.check(
        org.id,
        {
          content: body.content,
          hasMedia: body.hasMedia,
          mediaType: body.mediaType,
        },
        body.platforms
      );
    } catch (e) {
      if (e instanceof NoCheckerConfigError) {
        throw new HttpException('No AI key configured', HttpStatus.CONFLICT);
      }
      throw e;
    }
  }

  @Post('/rewrite')
  async rewrite(
    @GetOrgFromRequest() org: Organization,
    @Body() body: RewritePostDto
  ) {
    try {
      return await this._postChecker.rewrite(org.id, {
        content: body.content,
        tone: body.tone as any,
        count: body.count,
        platform: body.platform,
      });
    } catch (e) {
      if (e instanceof NoCheckerConfigError) {
        throw new HttpException('No AI key configured', HttpStatus.CONFLICT);
      }
      throw e;
    }
  }

  @Get('/:id/statistics')
  async getStatistics(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._postsService.getStatistics(org.id, id);
  }

  @Get('/:id/missing')
  async getMissingContent(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._postsService.getMissingContent(org.id, id);
  }

  @Put('/:id/release-id')
  async updateReleaseId(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('releaseId') releaseId: string
  ) {
    return this._postsService.updateReleaseId(org.id, id, releaseId);
  }

  @Post('/should-shortlink')
  async shouldShortlink(@Body() body: { messages: string[] }) {
    return { ask: this._shortLinkService.askShortLinkedin(body.messages) };
  }

  @Post('/:id/comments')
  async createComment(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: { comment: string }
  ) {
    return this._postsService.createComment(org.id, user.id, id, body.comment);
  }

  @Get('/:id/comments')
  async getComments(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._postsService.getCommentsForOrg(org.id, id);
  }

  @Get('/tags')
  async getTags(@GetOrgFromRequest() org: Organization) {
    return { tags: await this._postsService.getTags(org.id) };
  }

  @Post('/tags')
  async createTag(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateTagDto
  ) {
    return this._postsService.createTag(org.id, body);
  }

  @Put('/tags/:id')
  async editTag(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateTagDto,
    @Param('id') id: string
  ) {
    return this._postsService.editTag(id, org.id, body);
  }

  @Delete('/tags/:id')
  async deleteTag(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._postsService.deleteTag(id, org.id);
  }

  @Get('/')
  async getPosts(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetPostsDto
  ) {
    return this._postsService.getPostsMinified(org.id, query);
  }

  @Get('/find-slot')
  async findSlot(@GetOrgFromRequest() org: Organization) {
    return { date: await this._postsService.findFreeDateTime(org.id) };
  }

  @Get('/find-slot/:id')
  async findSlotIntegration(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id?: string
  ) {
    return { date: await this._postsService.findFreeDateTime(org.id, id) };
  }

  @Get('/list')
  async getPostsList(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetPostsListDto
  ) {
    return this._postsService.getPostsList(org.id, query);
  }

  @Get('/old')
  oldPosts(
    @GetOrgFromRequest() org: Organization,
    @Query('date') date: string
  ) {
    return this._postsService.getOldPosts(org.id, date);
  }

  @Get('/group/:group/debug-export')
  async getPostGroupDebugExport(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('group') group: string
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Forbidden', 403);
    }
    return this._postsService.getPostGroupDebugExport(org.id, group);
  }

  @Get('/group/:group')
  getPostsByGroup(@GetOrgFromRequest() org: Organization, @Param('group') group: string) {
    return this._postsService.getPostsByGroup(org.id, group);
  }

  @Get('/smart-slots')
  async smartSlots(
    @GetOrgFromRequest() org: Organization,
    @Query('integration') integration: string,
    @Query('platform') platform: string,
    @Query('count') count?: string
  ) {
    // Audience timezone is resolved server-side from the channel's own
    // Integration.timezone, not a client-supplied offset (was the viewing
    // staff member's browser zone, not the channel's).
    return this._smartSlots.suggest(
      org.id,
      integration,
      platform,
      Number.isFinite(Number(count)) ? Number(count) : 3
    );
  }

  @Post('/csv-import')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  @UseInterceptors(FileInterceptor('file', uploadInterceptorOptions))
  async csvImport(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile()
    file: {
      originalname?: string;
      mimetype?: string;
      size?: number;
      buffer?: Buffer;
    },
    // Opt-in: import as DRAFT instead of straight to QUEUE, so a batch can go
    // through the (still fully optional) approval flow instead of publishing
    // unreviewed. Off by default — unchanged behavior for existing callers.
    @Body('asDraft') asDraft?: string
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('No file uploaded.');
    }
    const isCsv =
      /\.csv$/i.test(file.originalname || '') ||
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel';
    if (!isCsv) {
      throw new BadRequestException('File must be a .csv');
    }
    if ((file.size ?? 0) > 2 * 1024 * 1024) {
      throw new BadRequestException('CSV exceeds the 2 MB limit.');
    }
    return this._csvImport.importCSV(org.id, file.buffer, asDraft === 'true');
  }

  @Get('/comment-providers')
  commentProviders() {
    return { providers: COMMENT_PROVIDERS };
  }

  @Get('/:id')
  getPost(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._postsService.getPost(org.id, id);
  }

  @Post('/valid')
  async validatePosts(
    @GetOrgFromRequest() org: Organization,
    @Body() rawBody: any
  ) {
    return this._postsService.validatePosts(org.id, rawBody?.posts || []);
  }

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async createPost(
    @GetOrgFromRequest() org: Organization,
    @Body() rawBody: any
  ) {
    // Server-side validation — never trust the client to have validated.
    const validation = await this._postsService.validatePosts(
      org.id,
      rawBody?.posts || []
    );

    const fail = (item: (typeof validation)[number], error: string) => {
      throw new PostValidationException({
        provider: item.identifier,
        name: item.name,
        error,
      });
    };

    for (const item of validation) {
      if (item.emptyContent && rawBody?.type !== 'draft') {
        fail(
          item,
          'Your post should have at least one character or one image.'
        );
      }
    }

    if (rawBody?.type !== 'draft') {
      for (const item of validation) {
        if (!item.valid) {
          fail(item, item.settingsError || 'Please fix your settings');
        }
        if (item.errors !== true) {
          fail(item, item.errors as string);
        }
        if (item.tooLong) {
          fail(item, 'post is too long, please fix it');
        }
      }
    }

    const body = await this._postsService.mapTypeToPost(rawBody, org.id);
    return this._postsService.createPost(org.id, body, 'WEB');
  }

  @Delete('/:group')
  deletePost(
    @GetOrgFromRequest() org: Organization,
    @Param('group') group: string
  ) {
    return this._postsService.deletePost(org.id, group);
  }

  @Put('/:id/date')
  changeDate(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('date') date: string,
    @Body('action') action: 'schedule' | 'update' = 'schedule'
  ) {
    return this._postsService.changeDate(org.id, id, date, action);
  }

  /**
   * Duplicate a post group as a new draft.
   * Optionally target a different channel by passing `targetIntegrationId`.
   * PostSider-exclusive — not available in the OSS version.
   */
  @Post('/group/:group/duplicate')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async duplicatePost(
    @GetOrgFromRequest() org: Organization,
    @Param('group') group: string,
    @Body() body: { targetIntegrationId?: string; date?: string },
  ) {
    return this._postsService.duplicatePost(org.id, group, body.targetIntegrationId, body.date);
  }
}
