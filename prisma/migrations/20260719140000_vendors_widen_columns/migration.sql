-- Widen tight vendor VARCHAR columns for SAP-style master data payloads
ALTER TABLE "vendors" ALTER COLUMN "phone" TYPE VARCHAR(50);
ALTER TABLE "vendors" ALTER COLUMN "address" TYPE VARCHAR(500);
ALTER TABLE "vendors" ALTER COLUMN "tax_id" TYPE VARCHAR(80);
