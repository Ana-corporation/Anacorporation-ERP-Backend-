-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "company_status" AS ENUM ('trial', 'active', 'suspended', 'cancelled');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('active', 'expired', 'cancelled', 'trial', 'pending');

-- CreateEnum
CREATE TYPE "billing_cycle" AS ENUM ('monthly', 'yearly', 'quarterly');

-- CreateEnum
CREATE TYPE "license_type" AS ENUM ('named', 'concurrent');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('active', 'suspended', 'left', 'invited');

-- CreateEnum
CREATE TYPE "module_access_type" AS ENUM ('grant', 'deny');

-- CreateEnum
CREATE TYPE "permission_action" AS ENUM ('view', 'create', 'edit', 'delete', 'approve', 'export', 'print', 'import', 'manage');

-- CreateEnum
CREATE TYPE "mfa_type" AS ENUM ('totp', 'sms', 'email', 'webauthn');

-- CreateEnum
CREATE TYPE "hash_algorithm" AS ENUM ('bcrypt', 'argon2id', 'argon2i', 'scrypt', 'pbkdf2');

-- CreateEnum
CREATE TYPE "gender" AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('active', 'expired', 'revoked', 'logged_out');

-- CreateEnum
CREATE TYPE "login_result" AS ENUM ('success', 'failure');

-- CreateEnum
CREATE TYPE "api_key_status" AS ENUM ('active', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "delegation_status" AS ENUM ('active', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "consent_type" AS ENUM ('privacy_policy', 'terms', 'nda', 'marketing', 'cookies');

-- CreateEnum
CREATE TYPE "signature_type" AS ENUM ('invoice', 'purchase', 'approval', 'digital_certificate', 'rubber_stamp');

-- CreateEnum
CREATE TYPE "document_type" AS ENUM ('passport', 'driving_license', 'contract', 'resume', 'certificate', 'nda', 'other');

-- CreateEnum
CREATE TYPE "user_audit_action" AS ENUM ('create', 'update', 'delete', 'login', 'logout', 'role_change', 'password_change', 'mfa_enable', 'mfa_disable', 'lock', 'unlock', 'invite', 'suspend', 'restore');

-- CreateEnum
CREATE TYPE "theme" AS ENUM ('light', 'dark', 'system');

-- CreateTable
CREATE TABLE "currencies" (
    "currency_id" BIGSERIAL NOT NULL,
    "code" VARCHAR(3) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "symbol" VARCHAR(8),
    "decimal_places" SMALLINT NOT NULL DEFAULT 2,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("currency_id")
);

-- CreateTable
CREATE TABLE "super_admins" (
    "super_admin_id" BIGSERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "is_mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "super_admins_pkey" PRIMARY KEY ("super_admin_id")
);

-- CreateTable
CREATE TABLE "companies" (
    "company_id" BIGSERIAL NOT NULL,
    "company_code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "legal_name" VARCHAR(255),
    "domain" VARCHAR(255),
    "email" VARCHAR(255),
    "phone" VARCHAR(30),
    "tax_number" VARCHAR(50),
    "address_line1" VARCHAR(255),
    "address_line2" VARCHAR(255),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "country" VARCHAR(100),
    "postal_code" VARCHAR(20),
    "timezone" VARCHAR(60) NOT NULL DEFAULT 'UTC',
    "default_currency_id" BIGINT,
    "logo_url" VARCHAR(500),
    "status" "company_status" NOT NULL DEFAULT 'trial',
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "plan_id" BIGSERIAL NOT NULL,
    "plan_code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "billing_cycle" "billing_cycle" NOT NULL DEFAULT 'monthly',
    "max_users" INTEGER,
    "max_storage_gb" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("plan_id")
);

-- CreateTable
CREATE TABLE "modules" (
    "module_id" BIGSERIAL NOT NULL,
    "module_code" VARCHAR(40) NOT NULL,
    "module_name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(80),
    "parent_module_id" BIGINT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "modules_pkey" PRIMARY KEY ("module_id")
);

-- CreateTable
CREATE TABLE "plan_modules" (
    "plan_module_id" BIGSERIAL NOT NULL,
    "plan_id" BIGINT NOT NULL,
    "module_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_modules_pkey" PRIMARY KEY ("plan_module_id")
);

-- CreateTable
CREATE TABLE "company_subscriptions" (
    "company_subscription_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "plan_id" BIGINT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "billing_cycle" "billing_cycle" NOT NULL DEFAULT 'monthly',
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "auto_renew" BOOLEAN NOT NULL DEFAULT true,
    "status" "subscription_status" NOT NULL DEFAULT 'pending',
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "company_subscriptions_pkey" PRIMARY KEY ("company_subscription_id")
);

-- CreateTable
CREATE TABLE "company_modules" (
    "company_module_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "module_id" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "activated_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiry_date" DATE,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "company_modules_pkey" PRIMARY KEY ("company_module_id")
);

-- CreateTable
CREATE TABLE "company_security_policies" (
    "policy_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "password_expiry_days" INTEGER DEFAULT 90,
    "password_never_expires" BOOLEAN NOT NULL DEFAULT false,
    "force_password_rotation" BOOLEAN NOT NULL DEFAULT false,
    "min_password_length" SMALLINT NOT NULL DEFAULT 8,
    "require_strong_password" BOOLEAN NOT NULL DEFAULT true,
    "require_mfa" BOOLEAN NOT NULL DEFAULT false,
    "max_login_attempts" SMALLINT NOT NULL DEFAULT 5,
    "lockout_duration_min" INTEGER NOT NULL DEFAULT 30,
    "allow_multiple_logins" BOOLEAN NOT NULL DEFAULT true,
    "max_concurrent_sessions" SMALLINT,
    "session_timeout_min" INTEGER NOT NULL DEFAULT 60,
    "license_type" "license_type" NOT NULL DEFAULT 'named',
    "total_licenses" INTEGER,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "company_security_policies_pkey" PRIMARY KEY ("policy_id")
);

-- CreateTable
CREATE TABLE "branches" (
    "branch_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "branch_code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "address" VARCHAR(255),
    "city" VARCHAR(100),
    "country" VARCHAR(100),
    "phone" VARCHAR(30),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("branch_id")
);

-- CreateTable
CREATE TABLE "departments" (
    "department_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "department_code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "parent_department_id" BIGINT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("department_id")
);

-- CreateTable
CREATE TABLE "designations" (
    "designation_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "designation_code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "grade_level" SMALLINT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "designations_pkey" PRIMARY KEY ("designation_id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "warehouse_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "branch_id" BIGINT,
    "warehouse_code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "address" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("warehouse_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "role_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT,
    "role_code" VARCHAR(40) NOT NULL,
    "role_name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_template" BOOLEAN NOT NULL DEFAULT false,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "permission_id" BIGSERIAL NOT NULL,
    "module_id" BIGINT NOT NULL,
    "permission_code" VARCHAR(60) NOT NULL,
    "permission_name" VARCHAR(120) NOT NULL,
    "action" "permission_action" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("permission_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_permission_id" BIGSERIAL NOT NULL,
    "role_id" BIGINT NOT NULL,
    "module_id" BIGINT NOT NULL,
    "permission_id" BIGINT NOT NULL,
    "is_allowed" BOOLEAN NOT NULL DEFAULT true,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_permission_id")
);

-- CreateTable
CREATE TABLE "users" (
    "user_id" BIGSERIAL NOT NULL,
    "user_code" VARCHAR(40),
    "username" VARCHAR(100) NOT NULL,
    "display_name" VARCHAR(200),
    "first_name" VARCHAR(100),
    "middle_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "preferred_name" VARCHAR(100),
    "gender" "gender",
    "date_of_birth" DATE,
    "email" VARCHAR(255) NOT NULL,
    "secondary_email" VARCHAR(255),
    "mobile" VARCHAR(30),
    "alternate_mobile" VARCHAR(30),
    "country_code" VARCHAR(8),
    "language_code" VARCHAR(10) NOT NULL DEFAULT 'en',
    "time_zone" VARCHAR(60) NOT NULL DEFAULT 'UTC',
    "culture_code" VARCHAR(15),
    "profile_photo" VARCHAR(500),
    "signature_image" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "lock_reason" VARCHAR(255),
    "remarks" TEXT,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_authentication" (
    "authentication_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "password_salt" VARCHAR(255),
    "hash_algorithm" "hash_algorithm" NOT NULL DEFAULT 'bcrypt',
    "password_version" INTEGER DEFAULT 1,
    "password_changed_date" TIMESTAMP(3),
    "password_expires_date" TIMESTAMP(3),
    "password_never_expires" BOOLEAN NOT NULL DEFAULT false,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "account_expiration_date" TIMESTAMP(3),
    "failed_login_count" SMALLINT NOT NULL DEFAULT 0,
    "last_failed_login" TIMESTAMP(3),
    "last_successful_login" TIMESTAMP(3),
    "last_password_reset" TIMESTAMP(3),
    "security_stamp" VARCHAR(100),
    "refresh_token" VARCHAR(500),
    "refresh_token_expiry" TIMESTAMP(3),
    "account_locked_until" TIMESTAMP(3),
    "is_mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_type" "mfa_type",
    "otp_secret" VARCHAR(255),
    "recovery_codes" TEXT,
    "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_authentication_pkey" PRIMARY KEY ("authentication_id")
);

-- CreateTable
CREATE TABLE "user_mfa" (
    "user_mfa_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "mfa_type" "mfa_type" NOT NULL,
    "secret" VARCHAR(255),
    "phone" VARCHAR(30),
    "email" VARCHAR(255),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "verified_at" TIMESTAMP(3),
    "recovery_codes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "user_mfa_pkey" PRIMARY KEY ("user_mfa_id")
);

-- CreateTable
CREATE TABLE "user_companies" (
    "user_company_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "employee_id" VARCHAR(40),
    "department_id" BIGINT,
    "designation_id" BIGINT,
    "branch_id" BIGINT,
    "warehouse_id" BIGINT,
    "default_currency_id" BIGINT,
    "license_type" "license_type" NOT NULL DEFAULT 'named',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "hire_date" DATE,
    "exit_date" DATE,
    "status" "membership_status" NOT NULL DEFAULT 'invited',
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMP(3),
    "deleted_by" BIGINT,
    "deleted_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_companies_pkey" PRIMARY KEY ("user_company_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_role_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "role_id" BIGINT NOT NULL,
    "assigned_by" BIGINT,
    "assigned_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_until" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_role_id")
);

-- CreateTable
CREATE TABLE "user_module_access" (
    "user_module_access_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "module_id" BIGINT NOT NULL,
    "access_type" "module_access_type" NOT NULL DEFAULT 'grant',
    "reason" VARCHAR(255),
    "expiry_date" DATE,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_module_access_pkey" PRIMARY KEY ("user_module_access_id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "preference_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "company_id" BIGINT,
    "theme" "theme" NOT NULL DEFAULT 'light',
    "accent_color" VARCHAR(20),
    "language" VARCHAR(10) NOT NULL DEFAULT 'en',
    "dashboard_layout" VARCHAR(40),
    "home_page" VARCHAR(120),
    "menu_style" VARCHAR(30),
    "font_size" VARCHAR(20),
    "density" VARCHAR(20),
    "date_format" VARCHAR(30) NOT NULL DEFAULT 'yyyy-MM-dd',
    "time_format" VARCHAR(20) NOT NULL DEFAULT 'HH:mm',
    "number_format" VARCHAR(30),
    "currency_format" VARCHAR(30),
    "default_printer" VARCHAR(120),
    "default_report_format" VARCHAR(20),
    "default_warehouse_id" BIGINT,
    "default_branch_id" BIGINT,
    "default_financial_year" VARCHAR(20),
    "default_screen" VARCHAR(120),
    "notification_preference" VARCHAR(40),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("preference_id")
);

-- CreateTable
CREATE TABLE "user_devices" (
    "device_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "device_uuid" VARCHAR(100) NOT NULL,
    "device_name" VARCHAR(150),
    "manufacturer" VARCHAR(100),
    "model" VARCHAR(100),
    "os" VARCHAR(80),
    "browser" VARCHAR(80),
    "last_seen" TIMESTAMP(3),
    "is_trusted" BOOLEAN NOT NULL DEFAULT false,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("device_id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "session_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "company_id" BIGINT,
    "device_id" BIGINT,
    "login_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logout_time" TIMESTAMP(3),
    "jwt_token" VARCHAR(1000),
    "refresh_token" VARCHAR(500),
    "browser" VARCHAR(80),
    "browser_version" VARCHAR(40),
    "operating_system" VARCHAR(80),
    "device_type" VARCHAR(30),
    "device_name" VARCHAR(150),
    "ip_address" TEXT,
    "country" VARCHAR(100),
    "city" VARCHAR(100),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "session_status" "session_status" NOT NULL DEFAULT 'active',

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "user_login_history" (
    "login_history_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT,
    "company_id" BIGINT,
    "login_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "login_result" "login_result" NOT NULL,
    "failure_reason" VARCHAR(150),
    "ip_address" TEXT,
    "browser" VARCHAR(80),
    "device" VARCHAR(120),
    "country" VARCHAR(100),
    "city" VARCHAR(100),
    "session_duration" INTEGER,

    CONSTRAINT "user_login_history_pkey" PRIMARY KEY ("login_history_id")
);

-- CreateTable
CREATE TABLE "user_password_history" (
    "password_history_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "password_salt" VARCHAR(255),
    "hash_algorithm" VARCHAR(40),
    "changed_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" BIGINT,

    CONSTRAINT "user_password_history_pkey" PRIMARY KEY ("password_history_id")
);

-- CreateTable
CREATE TABLE "user_api_keys" (
    "api_key_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "company_id" BIGINT,
    "name" VARCHAR(120),
    "api_key" VARCHAR(120) NOT NULL,
    "secret_hash" VARCHAR(255) NOT NULL,
    "scope" VARCHAR(255),
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiry_date" TIMESTAMP(3),
    "last_used" TIMESTAMP(3),
    "status" "api_key_status" NOT NULL DEFAULT 'active',

    CONSTRAINT "user_api_keys_pkey" PRIMARY KEY ("api_key_id")
);

-- CreateTable
CREATE TABLE "user_notifications" (
    "notification_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sms_enabled" BOOLEAN NOT NULL DEFAULT false,
    "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "teams_enabled" BOOLEAN NOT NULL DEFAULT false,
    "slack_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("notification_id")
);

-- CreateTable
CREATE TABLE "user_signatures" (
    "signature_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "company_id" BIGINT,
    "signature_type" "signature_type" NOT NULL,
    "image_path" VARCHAR(500),
    "certificate_data" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "valid_from" DATE,
    "valid_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "user_signatures_pkey" PRIMARY KEY ("signature_id")
);

-- CreateTable
CREATE TABLE "user_attachments" (
    "attachment_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "company_id" BIGINT,
    "document_type" "document_type" NOT NULL,
    "file_name" VARCHAR(255),
    "file_path" VARCHAR(500) NOT NULL,
    "file_size" BIGINT,
    "mime_type" VARCHAR(120),
    "expiry_date" DATE,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by" BIGINT,
    "uploaded_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_attachments_pkey" PRIMARY KEY ("attachment_id")
);

-- CreateTable
CREATE TABLE "user_delegations" (
    "delegation_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "delegate_user_id" BIGINT NOT NULL,
    "company_id" BIGINT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "reason" VARCHAR(255),
    "status" "delegation_status" NOT NULL DEFAULT 'active',
    "created_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_delegations_pkey" PRIMARY KEY ("delegation_id")
);

-- CreateTable
CREATE TABLE "user_consents" (
    "consent_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "company_id" BIGINT,
    "consent_type" "consent_type" NOT NULL,
    "consent_version" VARCHAR(20) NOT NULL,
    "is_accepted" BOOLEAN NOT NULL DEFAULT false,
    "accepted_date" TIMESTAMP(3),
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("consent_id")
);

-- CreateTable
CREATE TABLE "user_audit" (
    "audit_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT,
    "company_id" BIGINT,
    "action" "user_audit_action" NOT NULL,
    "entity_name" VARCHAR(80) NOT NULL,
    "entity_id" BIGINT,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" TEXT,
    "performed_by" BIGINT,
    "performed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_audit_pkey" PRIMARY KEY ("audit_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "currencies_code_key" ON "currencies"("code");

-- CreateIndex
CREATE UNIQUE INDEX "super_admins_email_key" ON "super_admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "companies_company_code_key" ON "companies"("company_code");

-- CreateIndex
CREATE UNIQUE INDEX "companies_domain_key" ON "companies"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_plan_code_key" ON "subscription_plans"("plan_code");

-- CreateIndex
CREATE UNIQUE INDEX "modules_module_code_key" ON "modules"("module_code");

-- CreateIndex
CREATE UNIQUE INDEX "plan_modules_plan_id_module_id_key" ON "plan_modules"("plan_id", "module_id");

-- CreateIndex
CREATE INDEX "company_subscriptions_company_id_idx" ON "company_subscriptions"("company_id");

-- CreateIndex
CREATE INDEX "company_modules_company_id_idx" ON "company_modules"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_modules_company_id_module_id_key" ON "company_modules"("company_id", "module_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_security_policies_company_id_key" ON "company_security_policies"("company_id");

-- CreateIndex
CREATE INDEX "branches_company_id_idx" ON "branches"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "branches_company_id_branch_code_key" ON "branches"("company_id", "branch_code");

-- CreateIndex
CREATE INDEX "departments_company_id_idx" ON "departments"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_company_id_department_code_key" ON "departments"("company_id", "department_code");

-- CreateIndex
CREATE INDEX "designations_company_id_idx" ON "designations"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "designations_company_id_designation_code_key" ON "designations"("company_id", "designation_code");

-- CreateIndex
CREATE INDEX "warehouses_company_id_idx" ON "warehouses"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_company_id_warehouse_code_key" ON "warehouses"("company_id", "warehouse_code");

-- CreateIndex
CREATE INDEX "roles_company_id_idx" ON "roles"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_company_id_role_code_key" ON "roles"("company_id", "role_code");

-- CreateIndex
CREATE INDEX "permissions_module_id_idx" ON "permissions"("module_id");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_module_id_permission_code_key" ON "permissions"("module_id", "permission_code");

-- CreateIndex
CREATE INDEX "role_permissions_role_id_idx" ON "role_permissions"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_id_permission_id_key" ON "role_permissions"("role_id", "permission_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_user_code_key" ON "users"("user_code");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_authentication_user_id_key" ON "user_authentication"("user_id");

-- CreateIndex
CREATE INDEX "user_mfa_user_id_idx" ON "user_mfa"("user_id");

-- CreateIndex
CREATE INDEX "user_companies_user_id_idx" ON "user_companies"("user_id");

-- CreateIndex
CREATE INDEX "user_companies_company_id_idx" ON "user_companies"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_companies_user_id_company_id_key" ON "user_companies"("user_id", "company_id");

-- CreateIndex
CREATE INDEX "user_roles_user_id_company_id_idx" ON "user_roles"("user_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_company_id_role_id_key" ON "user_roles"("user_id", "company_id", "role_id");

-- CreateIndex
CREATE INDEX "user_module_access_user_id_company_id_idx" ON "user_module_access"("user_id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_module_access_user_id_company_id_module_id_key" ON "user_module_access"("user_id", "company_id", "module_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_user_id_company_id_key" ON "user_preferences"("user_id", "company_id");

-- CreateIndex
CREATE INDEX "user_devices_user_id_idx" ON "user_devices"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_user_id_device_uuid_key" ON "user_devices"("user_id", "device_uuid");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "user_sessions_session_status_idx" ON "user_sessions"("session_status");

-- CreateIndex
CREATE INDEX "user_login_history_user_id_idx" ON "user_login_history"("user_id");

-- CreateIndex
CREATE INDEX "user_password_history_user_id_idx" ON "user_password_history"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_api_keys_api_key_key" ON "user_api_keys"("api_key");

-- CreateIndex
CREATE INDEX "user_api_keys_user_id_idx" ON "user_api_keys"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_notifications_user_id_key" ON "user_notifications"("user_id");

-- CreateIndex
CREATE INDEX "user_audit_user_id_idx" ON "user_audit"("user_id");

-- CreateIndex
CREATE INDEX "user_audit_entity_name_entity_id_idx" ON "user_audit"("entity_name", "entity_id");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_default_currency_id_fkey" FOREIGN KEY ("default_currency_id") REFERENCES "currencies"("currency_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modules" ADD CONSTRAINT "modules_parent_module_id_fkey" FOREIGN KEY ("parent_module_id") REFERENCES "modules"("module_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_modules" ADD CONSTRAINT "plan_modules_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("plan_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_modules" ADD CONSTRAINT "plan_modules_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("module_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("plan_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_modules" ADD CONSTRAINT "company_modules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_modules" ADD CONSTRAINT "company_modules_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("module_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_security_policies" ADD CONSTRAINT "company_security_policies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_department_id_fkey" FOREIGN KEY ("parent_department_id") REFERENCES "departments"("department_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "designations" ADD CONSTRAINT "designations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("branch_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("module_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("module_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("permission_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_authentication" ADD CONSTRAINT "user_authentication_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mfa" ADD CONSTRAINT "user_mfa_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("department_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_designation_id_fkey" FOREIGN KEY ("designation_id") REFERENCES "designations"("designation_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("branch_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("warehouse_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_default_currency_id_fkey" FOREIGN KEY ("default_currency_id") REFERENCES "currencies"("currency_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_module_access" ADD CONSTRAINT "user_module_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_module_access" ADD CONSTRAINT "user_module_access_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_module_access" ADD CONSTRAINT "user_module_access_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "modules"("module_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_default_warehouse_id_fkey" FOREIGN KEY ("default_warehouse_id") REFERENCES "warehouses"("warehouse_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_default_branch_id_fkey" FOREIGN KEY ("default_branch_id") REFERENCES "branches"("branch_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "user_devices"("device_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_login_history" ADD CONSTRAINT "user_login_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_login_history" ADD CONSTRAINT "user_login_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_password_history" ADD CONSTRAINT "user_password_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_api_keys" ADD CONSTRAINT "user_api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_api_keys" ADD CONSTRAINT "user_api_keys_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notifications" ADD CONSTRAINT "user_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_signatures" ADD CONSTRAINT "user_signatures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_signatures" ADD CONSTRAINT "user_signatures_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_attachments" ADD CONSTRAINT "user_attachments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_attachments" ADD CONSTRAINT "user_attachments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_delegations" ADD CONSTRAINT "user_delegations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_delegations" ADD CONSTRAINT "user_delegations_delegate_user_id_fkey" FOREIGN KEY ("delegate_user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_delegations" ADD CONSTRAINT "user_delegations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_audit" ADD CONSTRAINT "user_audit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_audit" ADD CONSTRAINT "user_audit_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("company_id") ON DELETE SET NULL ON UPDATE CASCADE;
