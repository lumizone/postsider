-- Add nullable logo (media URL) and defaultTimezone (IANA name, e.g.
-- "Europe/Warsaw") to Organization for the new Organization Settings page.
-- defaultTimezone is a fallback only: existing per-channel queue-plan
-- timezones (Integration.timezone, see 20260806110000_integration_timezone)
-- are unaffected and still take priority when set.
ALTER TABLE "Organization" ADD COLUMN "logo" TEXT;
ALTER TABLE "Organization" ADD COLUMN "defaultTimezone" TEXT;
