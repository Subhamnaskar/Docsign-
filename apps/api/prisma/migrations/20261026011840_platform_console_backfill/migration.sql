-- Seed activity history from existing sessions so the platform console is not empty on day one
UPDATE "User" u SET "lastLoginAt" = s.latest FROM (SELECT "userId", max("createdAt") AS latest FROM "Session" GROUP BY "userId") s WHERE s."userId" = u.id AND u."lastLoginAt" IS NULL;

INSERT INTO "ActiveDay" ("userId", "orgId", "day")
SELECT DISTINCT s."userId", u."orgId", s."lastSeenAt"::date FROM "Session" s JOIN "User" u ON u.id = s."userId"
UNION
SELECT DISTINCT s."userId", u."orgId", s."createdAt"::date FROM "Session" s JOIN "User" u ON u.id = s."userId"
ON CONFLICT DO NOTHING;
