-- Store categories on the existing location type (existing rows keep their type and code).
ALTER TYPE "warehouse_location_type" ADD VALUE IF NOT EXISTS 'RawMaterialStore';
ALTER TYPE "warehouse_location_type" ADD VALUE IF NOT EXISTS 'SparesStore';
ALTER TYPE "warehouse_location_type" ADD VALUE IF NOT EXISTS 'FinishedGoodsStore';
ALTER TYPE "warehouse_location_type" ADD VALUE IF NOT EXISTS 'BoughtOutStore';
ALTER TYPE "warehouse_location_type" ADD VALUE IF NOT EXISTS 'ElectricalStore';
ALTER TYPE "warehouse_location_type" ADD VALUE IF NOT EXISTS 'GeneralStore';
ALTER TYPE "warehouse_location_type" ADD VALUE IF NOT EXISTS 'OilStore';

-- Per-company running numbers for generated codes (RMS-001, SPR-001, ...).
CREATE TABLE "company_code_sequences" (
    "company_id" BIGINT NOT NULL,
    "scope" VARCHAR(40) NOT NULL,
    "prefix" VARCHAR(10) NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_code_sequences_pkey" PRIMARY KEY ("company_id","scope","prefix"),
    CONSTRAINT "company_code_sequences_last_number_non_negative" CHECK ("last_number" >= 0)
);

ALTER TABLE "company_code_sequences" ADD CONSTRAINT "company_code_sequences_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;
