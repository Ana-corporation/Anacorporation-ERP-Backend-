CREATE TABLE "mi_email_dispatches" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" BIGINT NOT NULL,
  "event_code" VARCHAR(40) NOT NULL,
  "doc_type" VARCHAR(20) NOT NULL,
  "doc_id" BIGINT NOT NULL,
  "task_id" BIGINT,
  "role_code" VARCHAR(30),
  "to_email" VARCHAR(255) NOT NULL,
  "subject" VARCHAR(200) NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
  "scheduled_at" TIMESTAMP(3) NOT NULL,
  "sent_at" TIMESTAMP(3),
  "error_text" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "mi_email_dispatches_due_idx" ON "mi_email_dispatches"("company_id", "status", "scheduled_at");
CREATE INDEX "mi_email_dispatches_doc_idx" ON "mi_email_dispatches"("company_id", "doc_type", "doc_id");
ALTER TABLE "mi_email_dispatches" ADD CONSTRAINT "mi_email_dispatches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE;
