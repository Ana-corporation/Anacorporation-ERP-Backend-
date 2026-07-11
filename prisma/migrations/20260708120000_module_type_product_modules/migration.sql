-- BE-4: module_type discriminator (product vs admin)

CREATE TYPE "module_type" AS ENUM ('product', 'admin');

ALTER TABLE "modules" ADD COLUMN "module_type" "module_type" NOT NULL DEFAULT 'admin';

UPDATE "modules"
SET "module_type" = 'admin'
WHERE "module_code" IN ('shared', 'organization', 'iam', 'subscription', 'platform');
