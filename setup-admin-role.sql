BEGIN;

-- Create the default roles
INSERT INTO "Roles" ("name", "createdAt", "updatedAt")
VALUES
('user', NOW(), NOW()),
('admin', NOW(), NOW())
ON CONFLICT ("name") DO NOTHING;

-- Assign the default user role to accounts without a role
UPDATE "Users"
SET "roleId" = (
  SELECT "id" FROM "Roles" WHERE "name" = 'user'
)
WHERE "roleId" IS NULL;

-- Promote Matt's account
UPDATE "Users"
SET "roleId" = (
  SELECT "id" FROM "Roles" WHERE "name" = 'admin'
)
WHERE "email" = 'matt@test.com';

-- Verify the result
SELECT
  u."id",
  u."username",
  u."email",
  r."name" AS "role"
FROM "Users" u
LEFT JOIN "Roles" r ON u."roleId" = r."id"
WHERE u."email" = 'matt@test.com';

COMMIT;
