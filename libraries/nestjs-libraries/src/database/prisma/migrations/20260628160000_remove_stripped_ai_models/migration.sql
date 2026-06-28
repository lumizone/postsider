-- Remove orphaned data left over from the stripped inherited AI / agent bridge:
--   * AutoPost (RSS auto-post feature, removed)
--   * AgentToken + its AuditLog relation (agent bridge, removed)
--   * mastra_* tables (Mastra agent memory/tracing, removed)
--   * CreationMethod.AUTOPOST and CreationMethod.MCP enum values (removed creation paths)
--   * Organization.hitlMode (agent "human in the loop" flag, removed)
-- AuditLog itself is kept (still written by the inbound webhook delivery flow).

-- AlterEnum
BEGIN;
CREATE TYPE "CreationMethod_new" AS ENUM ('UNKNOWN', 'WEB', 'API', 'CLI', 'CSV');
ALTER TABLE "Post" ALTER COLUMN "creationMethod" DROP DEFAULT;
ALTER TABLE "Post" ALTER COLUMN "creationMethod" TYPE "CreationMethod_new" USING ("creationMethod"::text::"CreationMethod_new");
ALTER TYPE "CreationMethod" RENAME TO "CreationMethod_old";
ALTER TYPE "CreationMethod_new" RENAME TO "CreationMethod";
DROP TYPE "CreationMethod_old";
ALTER TABLE "Post" ALTER COLUMN "creationMethod" SET DEFAULT 'UNKNOWN';
COMMIT;

-- DropForeignKey
ALTER TABLE "AutoPost" DROP CONSTRAINT "AutoPost_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "AgentToken" DROP CONSTRAINT "AgentToken_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_agentTokenId_fkey";

-- DropIndex
DROP INDEX "AuditLog_agentTokenId_idx";

-- AlterTable
ALTER TABLE "Organization" DROP COLUMN "hitlMode";

-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "agentTokenId";

-- DropTable
DROP TABLE "AutoPost";

-- DropTable
DROP TABLE "mastra_ai_spans";

-- DropTable
DROP TABLE "mastra_evals";

-- DropTable
DROP TABLE "mastra_messages";

-- DropTable
DROP TABLE "mastra_resources";

-- DropTable
DROP TABLE "mastra_scorers";

-- DropTable
DROP TABLE "mastra_threads";

-- DropTable
DROP TABLE "mastra_traces";

-- DropTable
DROP TABLE "mastra_workflow_snapshot";

-- DropTable
DROP TABLE "AgentToken";
