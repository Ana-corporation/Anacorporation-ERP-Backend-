-- Vendor form email invitations (secure token-based vendor form access)

CREATE TYPE "vendor_form_invitation_status" AS ENUM (
  'PENDING',
  'SENT',
  'SUBMITTED',
  'EXPIRED',
  'CANCELLED'
);

CREATE TABLE "vendor_form_invitations" (
    "id" BIGSERIAL NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "recipient_email" VARCHAR(255) NOT NULL,
    "generated_by" BIGINT,
    "generated_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "last_sent_at" TIMESTAMP(3),
    "next_reminder_at" TIMESTAMP(3),
    "send_count" INTEGER NOT NULL DEFAULT 0,
    "max_send_count" INTEGER NOT NULL DEFAULT 3,
    "status" "vendor_form_invitation_status" NOT NULL DEFAULT 'PENDING',
    "form_version" INTEGER NOT NULL DEFAULT 1,
    "field_snapshot" JSONB,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "vendor_form_invitations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vendor_form_invitations_vendor_id_status_idx"
  ON "vendor_form_invitations"("vendor_id", "status");

CREATE INDEX "vendor_form_invitations_token_hash_idx"
  ON "vendor_form_invitations"("token_hash");

CREATE INDEX "vendor_form_invitations_status_expires_at_next_reminder_at_idx"
  ON "vendor_form_invitations"("status", "expires_at", "next_reminder_at");

ALTER TABLE "vendor_form_invitations" ADD CONSTRAINT "vendor_form_invitations_vendor_id_fkey"
  FOREIGN KEY ("vendor_id") REFERENCES "vendors"("vendor_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_form_invitations" ADD CONSTRAINT "vendor_form_invitations_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;
