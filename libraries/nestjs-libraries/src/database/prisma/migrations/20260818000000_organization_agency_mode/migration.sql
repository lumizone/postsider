-- Add agencyMode: an opt-in flag (default false) that unhides the Agency/Overview
-- tab and its endpoints. Off by default — the tab stays hidden until an admin or
-- superadmin enables it in Settings → Organization.
ALTER TABLE "Organization" ADD COLUMN "agencyMode" BOOLEAN NOT NULL DEFAULT false;
