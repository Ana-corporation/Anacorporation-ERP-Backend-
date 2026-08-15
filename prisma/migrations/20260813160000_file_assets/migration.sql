-- File assets metadata for StorageService (GCS/provider-agnostic)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'file_status') THEN
    CREATE TYPE "file_status" AS ENUM ('PENDING', 'UPLOADED', 'FAILED', 'DELETED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "file_assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" VARCHAR(40) NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "original_name" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(120) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "storage_key" VARCHAR(500) NOT NULL,
  "bucket" VARCHAR(120) NOT NULL,
  "public_url" VARCHAR(1000),
  "status" "file_status" NOT NULL DEFAULT 'PENDING',
  "entity_type" VARCHAR(40),
  "entity_id" VARCHAR(40),
  "uploaded_by_id" VARCHAR(40),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "file_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "file_assets_organization_id_idx"
  ON "file_assets" ("organization_id");
CREATE INDEX IF NOT EXISTS "file_assets_organization_id_entity_type_entity_id_idx"
  ON "file_assets" ("organization_id", "entity_type", "entity_id");
