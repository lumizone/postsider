-- Postiz leftovers: tables for features this fork removed. Every one of them
-- was verified empty (0 rows) and unreferenced by any code path before this
-- migration was written.
--
-- The `mastra_*` tables are from the stripped AI agent and were never in the
-- Prisma schema at all — migration 20260628160000 removed the models but left
-- the tables behind.
--
-- Deliberately NOT dropped: Orders / OrderItems / Messages / MessagesGroup /
-- PayoutProblems (Post.submittedForOrder is still selected by the publish
-- path's getPostById), PopularPosts, Mentions and ExisingPlugData (still
-- referenced from code). Removing those means editing publish-critical
-- queries, which is not something to bundle into a cleanup.

DROP TABLE IF EXISTS "mastra_agent_versions" CASCADE;
DROP TABLE IF EXISTS "mastra_agents" CASCADE;
DROP TABLE IF EXISTS "mastra_background_tasks" CASCADE;
DROP TABLE IF EXISTS "mastra_channel_config" CASCADE;
DROP TABLE IF EXISTS "mastra_channel_installations" CASCADE;
DROP TABLE IF EXISTS "mastra_dataset_items" CASCADE;
DROP TABLE IF EXISTS "mastra_dataset_versions" CASCADE;
DROP TABLE IF EXISTS "mastra_datasets" CASCADE;
DROP TABLE IF EXISTS "mastra_experiment_results" CASCADE;
DROP TABLE IF EXISTS "mastra_experiments" CASCADE;
DROP TABLE IF EXISTS "mastra_favorites" CASCADE;
DROP TABLE IF EXISTS "mastra_mcp_client_versions" CASCADE;
DROP TABLE IF EXISTS "mastra_mcp_clients" CASCADE;
DROP TABLE IF EXISTS "mastra_mcp_server_versions" CASCADE;
DROP TABLE IF EXISTS "mastra_mcp_servers" CASCADE;
DROP TABLE IF EXISTS "mastra_notifications" CASCADE;
DROP TABLE IF EXISTS "mastra_observational_memory" CASCADE;
DROP TABLE IF EXISTS "mastra_prompt_block_versions" CASCADE;
DROP TABLE IF EXISTS "mastra_prompt_blocks" CASCADE;
DROP TABLE IF EXISTS "mastra_schedule_triggers" CASCADE;
DROP TABLE IF EXISTS "mastra_schedules" CASCADE;
DROP TABLE IF EXISTS "mastra_scorer_definition_versions" CASCADE;
DROP TABLE IF EXISTS "mastra_scorer_definitions" CASCADE;
DROP TABLE IF EXISTS "mastra_skill_blobs" CASCADE;
DROP TABLE IF EXISTS "mastra_skill_versions" CASCADE;
DROP TABLE IF EXISTS "mastra_skills" CASCADE;
DROP TABLE IF EXISTS "mastra_workspace_versions" CASCADE;
DROP TABLE IF EXISTS "mastra_workspaces" CASCADE;

-- Marketplace / trending models the fork does not use.
DROP TABLE IF EXISTS "SocialMediaAgencyNiche" CASCADE;
DROP TABLE IF EXISTS "SocialMediaAgency" CASCADE;
DROP TABLE IF EXISTS "ItemUser" CASCADE;
DROP TABLE IF EXISTS "Star" CASCADE;
DROP TABLE IF EXISTS "TrendingLog" CASCADE;
DROP TABLE IF EXISTS "Trending" CASCADE;
