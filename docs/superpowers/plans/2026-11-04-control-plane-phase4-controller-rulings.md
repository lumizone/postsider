# Phase 4 controller rulings on plan open questions (2026-11-04)
1. Review/blocked/failed tiles show the open backlog (not limited to today). Accepted.
2. "Published today" = state PUBLISHED and updatedAt within today. Accepted as proxy, documented in UI tooltip.
3. Index migration: a single CREATE INDEX CONCURRENTLY per migration file, verified with prisma migrate deploy on the throwaway Postgres; if Prisma wraps it in a transaction and it fails, use the plain-index fallback and document the lock.
4. Bulk approve/reject and retry stay admin/approver-only in the dashboard (consistent with existing approval roles).
5. List default filter = relevant (automation + any post in review or error).
6. Keep the ad hoc Playwright script (skips if missing); no new devDependency.
7. Policy text extraction can throw PolicyInputTooLargeError (Phase 3): dashboard write-time evaluation maps it to a 400 policy_input_too_large toast.
