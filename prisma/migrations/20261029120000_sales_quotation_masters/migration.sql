-- Sales Quotation groundwork (Phase 0 + Phase 1 masters):
--   companies: document/tax defaults (country, fiscal year, rounding, tax provider, quotation validity)
--   company_tax_identifiers / customers / customer_* / payment_terms: new masters
--   number series: CUSTOMER + SALES_QUOTATION document types, FISCAL_YEAR reset, pattern + period counters
--   idempotency_keys: replay-safe side-effect endpoints
-- ITEM number series behaviour is unchanged. No company data is seeded here.
-- Rollback: drop the new tables/columns/enum values (enum value removal needs a type rebuild).

-- AlterEnum (new values are not used inside this migration, so this is transaction-safe)
ALTER TYPE "number_series_document_type" ADD VALUE 'CUSTOMER';
ALTER TYPE "number_series_document_type" ADD VALUE 'SALES_QUOTATION';
ALTER TYPE "number_series_reset" ADD VALUE 'FISCAL_YEAR';

-- CreateEnum
CREATE TYPE "rounding_mode" AS ENUM ('HALF_UP', 'HALF_EVEN', 'DOWN');

-- CreateEnum
CREATE TYPE "rounding_stage" AS ENUM ('LINE', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "customer_address_type" AS ENUM ('BILL_TO', 'SHIP_TO');

-- Companies: document / tax defaults (existing rows get the defaults; ANA is set by a seed script, not here)
ALTER TABLE "companies" ADD COLUMN "country_code" CHAR(2);
ALTER TABLE "companies" ADD COLUMN "region_code" VARCHAR(10);
ALTER TABLE "companies" ADD COLUMN "locale" VARCHAR(15) NOT NULL DEFAULT 'en';
ALTER TABLE "companies" ADD COLUMN "fiscal_year_start_month" SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE "companies" ADD COLUMN "prices_include_tax" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "companies" ADD COLUMN "rounding_mode" "rounding_mode" NOT NULL DEFAULT 'HALF_UP';
ALTER TABLE "companies" ADD COLUMN "rounding_stage" "rounding_stage" NOT NULL DEFAULT 'DOCUMENT';
ALTER TABLE "companies" ADD COLUMN "default_paper_size" VARCHAR(10) NOT NULL DEFAULT 'A4';
ALTER TABLE "companies" ADD COLUMN "default_document_language" VARCHAR(10) NOT NULL DEFAULT 'en';
ALTER TABLE "companies" ADD COLUMN "exchange_rate_source" VARCHAR(20) NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "companies" ADD COLUMN "tax_provider_code" VARCHAR(20) NOT NULL DEFAULT 'NONE';
ALTER TABLE "companies" ADD COLUMN "default_quotation_validity_days" SMALLINT NOT NULL DEFAULT 30;

ALTER TABLE "companies" ADD CONSTRAINT "companies_fiscal_year_start_month_range"
  CHECK ("fiscal_year_start_month" BETWEEN 1 AND 12);
ALTER TABLE "companies" ADD CONSTRAINT "companies_default_quotation_validity_days_range"
  CHECK ("default_quotation_validity_days" BETWEEN 1 AND 365);

-- CreateTable
CREATE TABLE "company_tax_identifiers" (
    "company_tax_identifier_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "id_type" VARCHAR(20) NOT NULL,
    "id_label" VARCHAR(60),
    "id_value" VARCHAR(60) NOT NULL,
    "region_code" VARCHAR(10),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "company_tax_identifiers_pkey" PRIMARY KEY ("company_tax_identifier_id")
);

-- CreateTable
CREATE TABLE "payment_terms" (
    "payment_term_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "days" INTEGER NOT NULL DEFAULT 0,
    "description" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "payment_terms_pkey" PRIMARY KEY ("payment_term_id"),
    CONSTRAINT "payment_terms_days_min" CHECK ("days" >= 0)
);

-- CreateTable
CREATE TABLE "customers" (
    "customer_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "customer_code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "legal_name" VARCHAR(255),
    "customer_type" VARCHAR(20) NOT NULL DEFAULT 'BUSINESS',
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "website" VARCHAR(255),
    "currency_id" BIGINT,
    "payment_term_id" BIGINT,
    "credit_limit" DECIMAL(18,2),
    "salesperson_user_id" BIGINT,
    "notes" VARCHAR(1000),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("customer_id")
);

-- CreateTable
CREATE TABLE "customer_tax_identifiers" (
    "customer_tax_identifier_id" BIGSERIAL NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "id_type" VARCHAR(20) NOT NULL,
    "id_label" VARCHAR(60),
    "id_value" VARCHAR(60) NOT NULL,
    "region_code" VARCHAR(10),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "customer_tax_identifiers_pkey" PRIMARY KEY ("customer_tax_identifier_id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "customer_address_id" BIGSERIAL NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "address_type" "customer_address_type" NOT NULL DEFAULT 'BILL_TO',
    "label" VARCHAR(60),
    "line1" VARCHAR(255) NOT NULL,
    "line2" VARCHAR(255),
    "city" VARCHAR(100),
    "region" VARCHAR(100),
    "region_code" VARCHAR(10),
    "postal_code" VARCHAR(20),
    "country_code" CHAR(2),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("customer_address_id")
);

-- CreateTable
CREATE TABLE "customer_contacts" (
    "customer_contact_id" BIGSERIAL NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "designation" VARCHAR(100),
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "customer_contacts_pkey" PRIMARY KEY ("customer_contact_id")
);

-- Number series: document-number template for non-ITEM types (ITEM ignores it)
ALTER TABLE "number_series_configs" ADD COLUMN "pattern" VARCHAR(60);

-- CreateTable
CREATE TABLE "number_series_counters" (
    "number_series_counter_id" BIGSERIAL NOT NULL,
    "number_series_config_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "period_key" VARCHAR(10) NOT NULL DEFAULT '',
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "number_series_counters_pkey" PRIMARY KEY ("number_series_counter_id"),
    CONSTRAINT "number_series_counters_last_number_min" CHECK ("last_number" >= 0)
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "idempotency_key_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "user_id" BIGINT,
    "endpoint" VARCHAR(120) NOT NULL,
    "idempotency_key" VARCHAR(80) NOT NULL,
    "request_hash" VARCHAR(64),
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("idempotency_key_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_tax_identifiers_company_id_id_type_id_value_key" ON "company_tax_identifiers"("company_id", "id_type", "id_value");
CREATE INDEX "company_tax_identifiers_company_id_idx" ON "company_tax_identifiers"("company_id");

CREATE UNIQUE INDEX "payment_terms_company_id_code_key" ON "payment_terms"("company_id", "code");
CREATE INDEX "payment_terms_company_id_idx" ON "payment_terms"("company_id");

CREATE UNIQUE INDEX "customers_company_id_customer_code_key" ON "customers"("company_id", "customer_code");
CREATE INDEX "customers_company_id_idx" ON "customers"("company_id");
CREATE INDEX "customers_company_id_name_idx" ON "customers"("company_id", "name");

CREATE UNIQUE INDEX "customer_tax_identifiers_customer_id_id_type_id_value_key" ON "customer_tax_identifiers"("customer_id", "id_type", "id_value");
CREATE INDEX "customer_tax_identifiers_company_id_idx" ON "customer_tax_identifiers"("company_id");
CREATE INDEX "customer_tax_identifiers_customer_id_idx" ON "customer_tax_identifiers"("customer_id");

CREATE INDEX "customer_addresses_company_id_idx" ON "customer_addresses"("company_id");
CREATE INDEX "customer_addresses_customer_id_idx" ON "customer_addresses"("customer_id");

CREATE INDEX "customer_contacts_company_id_idx" ON "customer_contacts"("company_id");
CREATE INDEX "customer_contacts_customer_id_idx" ON "customer_contacts"("customer_id");

CREATE UNIQUE INDEX "number_series_counters_number_series_config_id_period_key_key" ON "number_series_counters"("number_series_config_id", "period_key");
CREATE INDEX "number_series_counters_company_id_idx" ON "number_series_counters"("company_id");

CREATE UNIQUE INDEX "idempotency_keys_company_id_idempotency_key_endpoint_key" ON "idempotency_keys"("company_id", "idempotency_key", "endpoint");
CREATE INDEX "idempotency_keys_company_id_created_at_idx" ON "idempotency_keys"("company_id", "created_at");

-- AddForeignKey
ALTER TABLE "company_tax_identifiers" ADD CONSTRAINT "company_tax_identifiers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payment_terms" ADD CONSTRAINT "payment_terms_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("currency_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("payment_term_id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_tax_identifiers" ADD CONSTRAINT "customer_tax_identifiers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("customer_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_tax_identifiers" ADD CONSTRAINT "customer_tax_identifiers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("customer_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("customer_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "number_series_counters" ADD CONSTRAINT "number_series_counters_number_series_config_id_fkey" FOREIGN KEY ("number_series_config_id") REFERENCES "number_series_configs"("number_series_config_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "number_series_counters" ADD CONSTRAINT "number_series_counters_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;
