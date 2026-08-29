-- Structured notifications: keep the rendered English `content` (used by email
-- and as a fallback), and add a machine-readable form so the dashboard can
-- translate the same notification into the customer's language.
ALTER TABLE "Notifications" ADD COLUMN "eventKey" TEXT;
ALTER TABLE "Notifications" ADD COLUMN "eventParams" TEXT;
