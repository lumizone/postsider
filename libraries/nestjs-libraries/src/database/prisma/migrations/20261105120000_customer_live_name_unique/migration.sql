-- Customer names must be unique per organization among LIVE rows.
-- The Prisma unique key ("orgId", "name", "deletedAt") does not enforce that:
-- Postgres treats NULL deletedAt values as distinct, so two live rows with the
-- same name could coexist (a race in customer create). A partial unique index
-- closes it. Prisma cannot express partial indexes in schema.prisma, so this
-- index lives only in SQL; do not "fix" it from a generated diff.

-- Step 1: de-duplicate existing live rows. For every (orgId, name) with more
-- than one live row the OLDEST (createdAt, id) is kept. Channels attached to a
-- duplicate are moved to the kept customer, then the duplicate is soft deleted
-- (deletedAt set, never hard deleted). Each duplicate gets a distinct deletedAt
-- (now() plus a per row millisecond offset; the column has millisecond precision) so the old unique key cannot clash.
WITH ranked AS (
  SELECT
    "id",
    FIRST_VALUE("id") OVER w AS "keepId",
    ROW_NUMBER() OVER w AS "rn"
  FROM "Customer"
  WHERE "deletedAt" IS NULL
  WINDOW w AS (PARTITION BY "orgId", "name" ORDER BY "createdAt" ASC, "id" ASC)
),
dups AS (
  SELECT "id", "keepId", "rn" FROM ranked WHERE "rn" > 1
),
moved AS (
  UPDATE "Integration" i
  SET "customerId" = d."keepId"
  FROM dups d
  WHERE i."customerId" = d."id"
  RETURNING i."id"
)
UPDATE "Customer" c
SET "deletedAt" = now() + (d."rn" * interval '1 millisecond'),
    "updatedAt" = now()
FROM dups d
WHERE c."id" = d."id";

-- Step 2: the partial unique index (live rows only).
CREATE UNIQUE INDEX "Customer_orgId_name_live_key"
  ON "Customer" ("orgId", "name")
  WHERE "deletedAt" IS NULL;
