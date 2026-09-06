-- Bulk import sessions (Vendor / Item / Opening Stock)

CREATE TYPE "import_type" AS ENUM ('VENDOR', 'ITEM', 'OPENING_STOCK');
CREATE TYPE "import_status" AS ENUM (
  'UPLOADED',
  'VALIDATING',
  'VALIDATED',
  'IMPORTING',
  'COMPLETED',
  'FAILED',
  'EXPIRED'
);

CREATE TABLE "import_sessions" (
    "import_session_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "created_by" BIGINT,
    "import_type" "import_type" NOT NULL,
    "status" "import_status" NOT NULL DEFAULT 'UPLOADED',
    "file_name" VARCHAR(255) NOT NULL,
    "file_mime" VARCHAR(120),
    "file_size_bytes" INTEGER NOT NULL,
    "storage_key" VARCHAR(500),
    "summary_json" JSONB,
    "rows_json" JSONB,
    "error_message" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "import_sessions_pkey" PRIMARY KEY ("import_session_id")
);

CREATE INDEX "import_sessions_company_id_import_type_created_at_idx"
  ON "import_sessions"("company_id", "import_type", "created_at");

CREATE INDEX "import_sessions_status_expires_at_idx"
  ON "import_sessions"("status", "expires_at");

ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;
