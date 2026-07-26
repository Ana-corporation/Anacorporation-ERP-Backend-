-- CreateTable
CREATE TABLE "items" (
    "item_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "item_code" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "old_code" VARCHAR(50),
    "item_type" VARCHAR(30) NOT NULL DEFAULT 'item',
    "item_group" VARCHAR(80),
    "uom_group" VARCHAR(80),
    "barcode" VARCHAR(100),
    "price_list" VARCHAR(80),
    "unit_price" DECIMAL(18,6),
    "currency_code" VARCHAR(10),
    "is_inventory_item" BOOLEAN NOT NULL DEFAULT true,
    "is_sales_item" BOOLEAN NOT NULL DEFAULT true,
    "is_purchase_item" BOOLEAN NOT NULL DEFAULT true,
    "do_not_apply_discount_groups" BOOLEAN NOT NULL DEFAULT false,
    "manufacturer" VARCHAR(120),
    "additional_identifier" VARCHAR(80),
    "shipping_type" VARCHAR(40),
    "manage_by" VARCHAR(20) NOT NULL DEFAULT 'none',
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "active_from" DATE,
    "active_to" DATE,
    "net_weight_kg" DECIMAL(18,6),
    "gross_weight_kg" DECIMAL(18,6),
    "division" VARCHAR(80),
    "core_activity" VARCHAR(80),
    "major_group" VARCHAR(120),
    "brand_name" VARCHAR(80),
    "effective_date" DATE,
    "customer_stock_no" VARCHAR(80),
    "stock_to_be" VARCHAR(80),
    "stock_dio_days" INTEGER,
    "contract_items_for" VARCHAR(120),
    "preferred_vendor_id" BIGINT,
    "valuation_method" VARCHAR(30),
    "item_cost" DECIMAL(18,6),
    "manage_stock_by_warehouse" BOOLEAN NOT NULL DEFAULT true,
    "remarks" TEXT,
    "purchase_json" JSONB,
    "sales_json" JSONB,
    "inventory_json" JSONB,
    "planning_json" JSONB,
    "production_json" JSONB,
    "properties_json" JSONB,
    "attachments_json" JSONB,
    "metadata" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "items_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "item_warehouse_stock" (
    "item_warehouse_stock_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "item_id" BIGINT NOT NULL,
    "warehouse_id" BIGINT NOT NULL,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "qty_on_hand" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "qty_committed" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "qty_ordered" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "required_qty" DECIMAL(18,6),
    "minimum_qty" DECIMAL(18,6),
    "maximum_qty" DECIMAL(18,6),
    "first_bin_location" VARCHAR(80),
    "default_bin_location" VARCHAR(80),
    "enforce_default_bin" BOOLEAN NOT NULL DEFAULT false,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "item_warehouse_stock_pkey" PRIMARY KEY ("item_warehouse_stock_id")
);

-- CreateIndex
CREATE INDEX "items_company_id_idx" ON "items"("company_id");

-- CreateIndex
CREATE INDEX "items_company_id_status_idx" ON "items"("company_id", "status");

-- CreateIndex
CREATE INDEX "items_company_id_item_group_idx" ON "items"("company_id", "item_group");

-- CreateIndex
CREATE INDEX "items_company_id_brand_name_idx" ON "items"("company_id", "brand_name");

-- CreateIndex
CREATE UNIQUE INDEX "items_company_id_item_code_key" ON "items"("company_id", "item_code");

-- CreateIndex
CREATE INDEX "item_warehouse_stock_company_id_idx" ON "item_warehouse_stock"("company_id");

-- CreateIndex
CREATE INDEX "item_warehouse_stock_warehouse_id_idx" ON "item_warehouse_stock"("warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "item_warehouse_stock_item_id_warehouse_id_key" ON "item_warehouse_stock"("item_id", "warehouse_id");

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_preferred_vendor_id_fkey" FOREIGN KEY ("preferred_vendor_id") REFERENCES "vendors"("vendor_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_warehouse_stock" ADD CONSTRAINT "item_warehouse_stock_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_warehouse_stock" ADD CONSTRAINT "item_warehouse_stock_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("item_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_warehouse_stock" ADD CONSTRAINT "item_warehouse_stock_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("warehouse_id") ON DELETE CASCADE ON UPDATE CASCADE;
