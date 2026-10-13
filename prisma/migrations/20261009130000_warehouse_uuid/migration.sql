-- System-generated UUID per inventory location; existing rows are filled by the default.
ALTER TABLE "warehouses" ADD COLUMN "uuid" UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "warehouses_uuid_key" ON "warehouses"("uuid");
