-- Preserve preview access for posts created before share-token previews existed.
-- This is a separate migration because the original share-token migration may
-- already be applied and Prisma migration checksums must remain immutable.
UPDATE "Post"
SET "shareToken" = md5(random()::text || clock_timestamp()::text || "id")
WHERE "shareToken" IS NULL;
