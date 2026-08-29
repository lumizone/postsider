-- Authentication events have no organization to attach to: a failed login is
-- an email that may not exist, and even a successful one is recorded before an
-- organization is resolved. Making the column nullable is what lets the audit
-- trail cover sign-in at all.
ALTER TABLE "AuditLog" ALTER COLUMN "organizationId" DROP NOT NULL;
