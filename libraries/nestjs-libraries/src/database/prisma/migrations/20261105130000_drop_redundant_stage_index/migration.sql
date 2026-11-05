-- The unique index ("approvalId", "position") already serves every lookup by
-- approvalId (leading column), so the single column index is redundant.
DROP INDEX IF EXISTS "PostApprovalStage_approvalId_idx";
