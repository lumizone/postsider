import { IntegrationValidationTool } from '@postsider/nestjs-libraries/chat/tools/integration.validation.tool';
import { IntegrationTriggerTool } from '@postsider/nestjs-libraries/chat/tools/integration.trigger.tool';
import { IntegrationSchedulePostTool } from './integration.schedule.post';
import { GenerateVideoOptionsTool } from '@postsider/nestjs-libraries/chat/tools/generate.video.options.tool';
import { VideoFunctionTool } from '@postsider/nestjs-libraries/chat/tools/video.function.tool';
import { GenerateVideoTool } from '@postsider/nestjs-libraries/chat/tools/generate.video.tool';
import { GenerateImageTool } from '@postsider/nestjs-libraries/chat/tools/generate.image.tool';
import { IntegrationListTool } from '@postsider/nestjs-libraries/chat/tools/integration.list.tool';
import { GroupListTool } from '@postsider/nestjs-libraries/chat/tools/group.list.tool';
import { UploadFromUrlTool } from '@postsider/nestjs-libraries/chat/tools/upload.from.url.tool';
import { PostsListTool } from '@postsider/nestjs-libraries/chat/tools/posts.list.tool';
import { PostsManageTool } from '@postsider/nestjs-libraries/chat/tools/posts.manage.tool';
import { AnalyticsTool } from '@postsider/nestjs-libraries/chat/tools/analytics.tool';
import { ChannelsManageTool } from '@postsider/nestjs-libraries/chat/tools/channels.manage.tool';
import { MediaListTool } from '@postsider/nestjs-libraries/chat/tools/media.list.tool';
import { TagsTool } from '@postsider/nestjs-libraries/chat/tools/tags.tool';
import { ConnectorsListTool } from '@postsider/nestjs-libraries/chat/tools/connectors.list.tool';
import { ConnectorAuthorizeTool } from '@postsider/nestjs-libraries/chat/tools/connector.authorize.tool';
import { InboundFetchTool } from '@postsider/nestjs-libraries/chat/tools/inbound.fetch.tool';
import { InboundSubscribeTool } from '@postsider/nestjs-libraries/chat/tools/inbound.subscribe.tool';

export const toolList = [
  // Read — discovery & information
  IntegrationListTool,
  GroupListTool,
  IntegrationValidationTool,
  PostsListTool,
  AnalyticsTool,
  MediaListTool,
  TagsTool,
  ConnectorsListTool,

  // Write — content creation
  IntegrationSchedulePostTool,
  IntegrationTriggerTool,
  GenerateVideoOptionsTool,
  VideoFunctionTool,
  GenerateVideoTool,
  GenerateImageTool,
  UploadFromUrlTool,

  // Manage — modify existing resources
  PostsManageTool,
  ChannelsManageTool,

  // Agent Bridge — connectors & inbound sources
  ConnectorAuthorizeTool,
  InboundFetchTool,
  InboundSubscribeTool,
];
