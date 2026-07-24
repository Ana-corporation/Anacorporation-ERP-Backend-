-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "field_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "field_name" VARCHAR(80) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "field_type" VARCHAR(40) NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "default_value" JSONB,
    "validation" JSONB,
    "options" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_filterable" BOOLEAN NOT NULL DEFAULT false,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("field_id")
);

-- CreateTable
CREATE TABLE "custom_field_values" (
    "value_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "record_id" BIGINT NOT NULL,
    "field_id" BIGINT NOT NULL,
    "value_text" VARCHAR(2000),
    "value_number" DECIMAL(18,6),
    "value_date" DATE,
    "value_bool" BOOLEAN,
    "value_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "custom_field_values_pkey" PRIMARY KEY ("value_id")
);

-- CreateIndex
CREATE INDEX "custom_field_definitions_company_id_entity_type_is_active_idx" ON "custom_field_definitions"("company_id", "entity_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_company_id_entity_type_field_name_key" ON "custom_field_definitions"("company_id", "entity_type", "field_name");

-- CreateIndex
CREATE INDEX "custom_field_values_company_id_entity_type_record_id_idx" ON "custom_field_values"("company_id", "entity_type", "record_id");

-- CreateIndex
CREATE INDEX "custom_field_values_company_id_field_id_value_text_idx" ON "custom_field_values"("company_id", "field_id", "value_text");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_values_field_id_record_id_key" ON "custom_field_values"("field_id", "record_id");

-- AddForeignKey
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "custom_field_definitions"("field_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;
