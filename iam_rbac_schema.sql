-- ============================================================================
--  ERP — Identity & Access Management (IAM) + Multi-Tenant RBAC Schema
--  Engine   : PostgreSQL 14+  (GCP Cloud SQL)
--  Author   : Platform / Architecture
--  Notes    : Tables are created in strict dependency order so this file can be
--             run top-to-bottom as a single migration. Every tenant-scoped table
--             carries company_id. Audit columns (created_*/updated_*/deleted_*/
--             row_version) repeat on every table for traceability + soft delete.
-- ============================================================================

-- Optional: run inside one transaction so a partial failure rolls back cleanly.
BEGIN;

-- ----------------------------------------------------------------------------
-- 0. GLOBAL MASTERS (no tenant scope)
-- ----------------------------------------------------------------------------

-- 0.1 currencies — global currency master referenced by companies & users
CREATE TABLE currencies (
    currency_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            VARCHAR(3)  NOT NULL UNIQUE,          -- ISO 4217, e.g. USD
    name            VARCHAR(100) NOT NULL,
    symbol          VARCHAR(8),
    decimal_places  SMALLINT     NOT NULL DEFAULT 2,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_by      BIGINT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by      BIGINT,
    updated_at      TIMESTAMPTZ,
    deleted_by      BIGINT,
    deleted_at      TIMESTAMPTZ,
    row_version     INTEGER      NOT NULL DEFAULT 1
);

-- ----------------------------------------------------------------------------
-- 1. PLATFORM LAYER (super admin, tenants, billing, modules)
-- ----------------------------------------------------------------------------

-- 1.1 super_admins — platform owners (manage every tenant, plan & subscription)
CREATE TABLE super_admins (
    super_admin_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                VARCHAR(150) NOT NULL,
    email               VARCHAR(255) NOT NULL UNIQUE,
    password_hash       VARCHAR(255) NOT NULL,
    is_mfa_enabled      BOOLEAN      NOT NULL DEFAULT FALSE,
    mfa_secret          VARCHAR(255),
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login_at       TIMESTAMPTZ,
    created_by          BIGINT,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    updated_at          TIMESTAMPTZ,
    deleted_by          BIGINT,
    deleted_at          TIMESTAMPTZ,
    row_version         INTEGER      NOT NULL DEFAULT 1
);

-- 1.2 companies — TENANT master. Root of every tenant-scoped relationship.
CREATE TABLE companies (
    company_id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_code        VARCHAR(30)  NOT NULL UNIQUE,
    name                VARCHAR(200) NOT NULL,
    legal_name          VARCHAR(255),
    domain              VARCHAR(255) UNIQUE,              -- e.g. acme.erp.com
    email               VARCHAR(255),
    phone               VARCHAR(30),
    tax_number          VARCHAR(50),
    address_line1       VARCHAR(255),
    address_line2       VARCHAR(255),
    city                VARCHAR(100),
    state               VARCHAR(100),
    country             VARCHAR(100),
    postal_code         VARCHAR(20),
    timezone            VARCHAR(60)  NOT NULL DEFAULT 'UTC',
    default_currency_id BIGINT       REFERENCES currencies(currency_id),
    logo_url            VARCHAR(500),
    status              VARCHAR(20)  NOT NULL DEFAULT 'trial', -- trial|active|suspended|cancelled
    created_by          BIGINT,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by          BIGINT,
    updated_at          TIMESTAMPTZ,
    deleted_by          BIGINT,
    deleted_at          TIMESTAMPTZ,
    row_version         INTEGER      NOT NULL DEFAULT 1
);

-- 1.3 subscription_plans — plan catalogue (Basic / Pro / Enterprise)
CREATE TABLE subscription_plans (
    plan_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plan_code       VARCHAR(30)  NOT NULL UNIQUE,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    price           NUMERIC(12,2) NOT NULL DEFAULT 0,
    billing_cycle   VARCHAR(20)  NOT NULL DEFAULT 'monthly', -- monthly|yearly|quarterly
    max_users       INTEGER,
    max_storage_gb  INTEGER,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_by      BIGINT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by      BIGINT,
    updated_at      TIMESTAMPTZ,
    deleted_by      BIGINT,
    deleted_at      TIMESTAMPTZ,
    row_version     INTEGER      NOT NULL DEFAULT 1
);

-- 1.4 modules — master list of ERP modules (Financials, Inventory, HCM, ...)
CREATE TABLE modules (
    module_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    module_code     VARCHAR(40)  NOT NULL UNIQUE,
    module_name     VARCHAR(120) NOT NULL,
    description     TEXT,
    icon            VARCHAR(80),
    parent_module_id BIGINT      REFERENCES modules(module_id), -- self FK for sub-modules
    sort_order      INTEGER      NOT NULL DEFAULT 0,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_by      BIGINT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by      BIGINT,
    updated_at      TIMESTAMPTZ,
    deleted_by      BIGINT,
    deleted_at      TIMESTAMPTZ,
    row_version     INTEGER      NOT NULL DEFAULT 1
);

-- 1.5 plan_modules — bridge: which modules ship inside each plan
CREATE TABLE plan_modules (
    plan_module_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plan_id         BIGINT NOT NULL REFERENCES subscription_plans(plan_id) ON DELETE CASCADE,
    module_id       BIGINT NOT NULL REFERENCES modules(module_id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_plan_modules UNIQUE (plan_id, module_id)
);

-- 1.6 company_subscriptions — which plan a tenant bought + validity window
CREATE TABLE company_subscriptions (
    company_subscription_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    plan_id         BIGINT NOT NULL REFERENCES subscription_plans(plan_id),
    start_date      DATE   NOT NULL,
    end_date        DATE,
    billing_cycle   VARCHAR(20) NOT NULL DEFAULT 'monthly',
    amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
    auto_renew      BOOLEAN NOT NULL DEFAULT TRUE,
    status          VARCHAR(20) NOT NULL DEFAULT 'active', -- active|expired|cancelled|trial
    created_by      BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      BIGINT,
    updated_at      TIMESTAMPTZ,
    deleted_by      BIGINT,
    deleted_at      TIMESTAMPTZ,
    row_version     INTEGER NOT NULL DEFAULT 1
);

-- 1.7 company_modules — modules actually ACTIVE for a tenant (incl. add-ons)
CREATE TABLE company_modules (
    company_module_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    module_id       BIGINT NOT NULL REFERENCES modules(module_id),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    activated_date  DATE    NOT NULL DEFAULT CURRENT_DATE,
    expiry_date     DATE,
    created_by      BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      BIGINT,
    updated_at      TIMESTAMPTZ,
    deleted_by      BIGINT,
    deleted_at      TIMESTAMPTZ,
    row_version     INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_company_modules UNIQUE (company_id, module_id)
);

-- 1.8 company_security_policies — per-tenant login/password/licensing policy
CREATE TABLE company_security_policies (
    policy_id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id          BIGINT NOT NULL UNIQUE REFERENCES companies(company_id) ON DELETE CASCADE,
    password_expiry_days    INTEGER DEFAULT 90,
    password_never_expires  BOOLEAN NOT NULL DEFAULT FALSE,
    force_password_rotation BOOLEAN NOT NULL DEFAULT FALSE,
    min_password_length     SMALLINT NOT NULL DEFAULT 8,
    require_strong_password BOOLEAN NOT NULL DEFAULT TRUE,
    require_mfa             BOOLEAN NOT NULL DEFAULT FALSE,
    max_login_attempts      SMALLINT NOT NULL DEFAULT 5,
    lockout_duration_min    INTEGER NOT NULL DEFAULT 30,
    allow_multiple_logins   BOOLEAN NOT NULL DEFAULT TRUE,
    max_concurrent_sessions SMALLINT,
    session_timeout_min     INTEGER NOT NULL DEFAULT 60,
    license_type            VARCHAR(20) DEFAULT 'named', -- named|concurrent
    total_licenses          INTEGER,
    created_by      BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      BIGINT,
    updated_at      TIMESTAMPTZ,
    row_version     INTEGER NOT NULL DEFAULT 1
);

-- ----------------------------------------------------------------------------
-- 2. ORGANISATION STRUCTURE (tenant-scoped lookups used by user membership)
-- ----------------------------------------------------------------------------

-- 2.1 branches
CREATE TABLE branches (
    branch_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    branch_code     VARCHAR(30) NOT NULL,
    name            VARCHAR(150) NOT NULL,
    address         VARCHAR(255),
    city            VARCHAR(100),
    country         VARCHAR(100),
    phone           VARCHAR(30),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      BIGINT,
    updated_at      TIMESTAMPTZ,
    deleted_by      BIGINT,
    deleted_at      TIMESTAMPTZ,
    row_version     INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_branches UNIQUE (company_id, branch_code)
);

-- 2.2 departments (self-referencing tree)
CREATE TABLE departments (
    department_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id          BIGINT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    department_code     VARCHAR(30) NOT NULL,
    name                VARCHAR(150) NOT NULL,
    parent_department_id BIGINT REFERENCES departments(department_id),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      BIGINT,
    updated_at      TIMESTAMPTZ,
    deleted_by      BIGINT,
    deleted_at      TIMESTAMPTZ,
    row_version     INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_departments UNIQUE (company_id, department_code)
);

-- 2.3 designations (job titles)
CREATE TABLE designations (
    designation_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    designation_code VARCHAR(30) NOT NULL,
    name            VARCHAR(150) NOT NULL,
    grade_level     SMALLINT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      BIGINT,
    updated_at      TIMESTAMPTZ,
    deleted_by      BIGINT,
    deleted_at      TIMESTAMPTZ,
    row_version     INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_designations UNIQUE (company_id, designation_code)
);

-- 2.4 warehouses (belong to a branch)
CREATE TABLE warehouses (
    warehouse_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    branch_id       BIGINT REFERENCES branches(branch_id),
    warehouse_code  VARCHAR(30) NOT NULL,
    name            VARCHAR(150) NOT NULL,
    address         VARCHAR(255),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      BIGINT,
    updated_at      TIMESTAMPTZ,
    deleted_by      BIGINT,
    deleted_at      TIMESTAMPTZ,
    row_version     INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_warehouses UNIQUE (company_id, warehouse_code)
);

-- ----------------------------------------------------------------------------
-- 3. RBAC LAYER (roles, permissions, role-permission mapping)
-- ----------------------------------------------------------------------------

-- 3.1 roles — company-scoped; company_id NULL = global template to clone
CREATE TABLE roles (
    role_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id      BIGINT REFERENCES companies(company_id) ON DELETE CASCADE, -- NULL = global template
    role_code       VARCHAR(40) NOT NULL,
    role_name       VARCHAR(120) NOT NULL,
    description     TEXT,
    is_system       BOOLEAN NOT NULL DEFAULT FALSE, -- protected, cannot delete
    is_template     BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE when company_id IS NULL
    created_by      BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      BIGINT,
    updated_at      TIMESTAMPTZ,
    deleted_by      BIGINT,
    deleted_at      TIMESTAMPTZ,
    row_version     INTEGER NOT NULL DEFAULT 1,
    -- role_code unique per company; templates (NULL company) kept unique separately
    CONSTRAINT uq_roles_company UNIQUE (company_id, role_code)
);

-- 3.2 permissions — atomic action per module (view/create/edit/delete/approve)
CREATE TABLE permissions (
    permission_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    module_id       BIGINT NOT NULL REFERENCES modules(module_id) ON DELETE CASCADE,
    permission_code VARCHAR(60) NOT NULL,  -- e.g. sales_order.view
    permission_name VARCHAR(120) NOT NULL,
    action          VARCHAR(30) NOT NULL,  -- view|create|edit|delete|approve|export|print
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_permissions UNIQUE (module_id, permission_code)
);

-- 3.3 role_permissions — maps role -> module -> permission
CREATE TABLE role_permissions (
    role_permission_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_id         BIGINT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    module_id       BIGINT NOT NULL REFERENCES modules(module_id) ON DELETE CASCADE,
    permission_id   BIGINT NOT NULL REFERENCES permissions(permission_id) ON DELETE CASCADE,
    is_allowed      BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_role_permissions UNIQUE (role_id, permission_id)
);

-- ----------------------------------------------------------------------------
-- 4. IDENTITY LAYER (global user identity + credentials)
-- ----------------------------------------------------------------------------

-- 4.1 users — ONE global identity (one login / one email) across all tenants.
--      Employment attributes (dept/branch/designation) live on user_companies.
CREATE TABLE users (
    user_id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_code       VARCHAR(40) UNIQUE,
    username        VARCHAR(100) NOT NULL UNIQUE,
    display_name    VARCHAR(200),
    first_name      VARCHAR(100),
    middle_name     VARCHAR(100),
    last_name       VARCHAR(100),
    preferred_name  VARCHAR(100),
    gender          VARCHAR(20),
    date_of_birth   DATE,
    email           VARCHAR(255) NOT NULL UNIQUE,
    secondary_email VARCHAR(255),
    mobile          VARCHAR(30),
    alternate_mobile VARCHAR(30),
    country_code    VARCHAR(8),
    language_code   VARCHAR(10) DEFAULT 'en',
    time_zone       VARCHAR(60) DEFAULT 'UTC',
    culture_code    VARCHAR(15),
    profile_photo   VARCHAR(500),
    signature_image VARCHAR(500),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    is_locked       BOOLEAN NOT NULL DEFAULT FALSE,
    lock_reason     VARCHAR(255),
    remarks         TEXT,
    created_by      BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      BIGINT,
    updated_at      TIMESTAMPTZ,
    deleted_by      BIGINT,
    deleted_at      TIMESTAMPTZ,
    row_version     INTEGER NOT NULL DEFAULT 1
);

-- 4.2 user_authentication — 1:1 with users; global credentials & lockout state
CREATE TABLE user_authentication (
    authentication_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id             BIGINT NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
    password_hash       VARCHAR(255) NOT NULL,
    password_salt       VARCHAR(255),
    hash_algorithm      VARCHAR(40) DEFAULT 'bcrypt',
    password_version    INTEGER DEFAULT 1,
    password_changed_date TIMESTAMPTZ,
    password_expires_date TIMESTAMPTZ,
    password_never_expires BOOLEAN NOT NULL DEFAULT FALSE,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    account_expiration_date TIMESTAMPTZ,
    failed_login_count  SMALLINT NOT NULL DEFAULT 0,
    last_failed_login   TIMESTAMPTZ,
    last_successful_login TIMESTAMPTZ,
    last_password_reset TIMESTAMPTZ,
    security_stamp      VARCHAR(100),
    refresh_token       VARCHAR(500),
    refresh_token_expiry TIMESTAMPTZ,
    account_locked_until TIMESTAMPTZ,
    is_mfa_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_type            VARCHAR(20),  -- totp|sms|email|webauthn
    otp_secret          VARCHAR(255),
    recovery_codes      TEXT,
    is_email_verified   BOOLEAN NOT NULL DEFAULT FALSE,
    is_phone_verified   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ,
    row_version         INTEGER NOT NULL DEFAULT 1
);

-- 4.3 user_mfa — multiple MFA methods per user
CREATE TABLE user_mfa (
    user_mfa_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    mfa_type        VARCHAR(20) NOT NULL,  -- totp|sms|email|webauthn
    secret          VARCHAR(255),
    phone           VARCHAR(30),
    email           VARCHAR(255),
    is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
    is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    verified_at     TIMESTAMPTZ,
    recovery_codes  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- 5. TENANT MEMBERSHIP + ROLE ASSIGNMENT (the "user -> company access" core)
-- ----------------------------------------------------------------------------

-- 5.1 user_companies — which tenants a user belongs to + employment data there
CREATE TABLE user_companies (
    user_company_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id             BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    company_id          BIGINT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    employee_id         VARCHAR(40),
    department_id       BIGINT REFERENCES departments(department_id),
    designation_id      BIGINT REFERENCES designations(designation_id),
    branch_id           BIGINT REFERENCES branches(branch_id),
    warehouse_id        BIGINT REFERENCES warehouses(warehouse_id),
    default_currency_id BIGINT REFERENCES currencies(currency_id),
    license_type        VARCHAR(20) DEFAULT 'named', -- named|concurrent
    is_default          BOOLEAN NOT NULL DEFAULT FALSE, -- default company on login
    hire_date           DATE,
    exit_date           DATE,
    status              VARCHAR(20) NOT NULL DEFAULT 'active', -- active|suspended|left
    created_by      BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by      BIGINT,
    updated_at      TIMESTAMPTZ,
    deleted_by      BIGINT,
    deleted_at      TIMESTAMPTZ,
    row_version     INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_user_companies UNIQUE (user_id, company_id)
);

-- 5.2 user_roles — role a user holds WITHIN a specific company
CREATE TABLE user_roles (
    user_role_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    company_id      BIGINT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    role_id         BIGINT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    assigned_by     BIGINT,
    assigned_date   TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until     TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version     INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_user_roles UNIQUE (user_id, company_id, role_id)
);

-- 5.3 user_module_access — fine-grained per-user override (grant/deny a module)
CREATE TABLE user_module_access (
    user_module_access_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    company_id      BIGINT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    module_id       BIGINT NOT NULL REFERENCES modules(module_id) ON DELETE CASCADE,
    access_type     VARCHAR(10) NOT NULL DEFAULT 'grant', -- grant|deny
    reason          VARCHAR(255),
    expiry_date     DATE,
    created_by      BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    row_version     INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_user_module_access UNIQUE (user_id, company_id, module_id)
);

-- ----------------------------------------------------------------------------
-- 6. USER EXPERIENCE / SECURITY SATELLITES
-- ----------------------------------------------------------------------------

-- 6.1 user_preferences — UI / formatting prefs (per user, optionally per company)
CREATE TABLE user_preferences (
    preference_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id             BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    company_id          BIGINT REFERENCES companies(company_id) ON DELETE CASCADE, -- NULL = global
    theme               VARCHAR(30) DEFAULT 'light',
    accent_color        VARCHAR(20),
    language            VARCHAR(10) DEFAULT 'en',
    dashboard_layout    VARCHAR(40),
    home_page           VARCHAR(120),
    menu_style          VARCHAR(30),
    font_size           VARCHAR(20),
    density             VARCHAR(20),
    date_format         VARCHAR(30) DEFAULT 'yyyy-MM-dd',
    time_format         VARCHAR(20) DEFAULT 'HH:mm',
    number_format       VARCHAR(30),
    currency_format     VARCHAR(30),
    default_printer     VARCHAR(120),
    default_report_format VARCHAR(20),
    default_warehouse_id BIGINT REFERENCES warehouses(warehouse_id),
    default_branch_id   BIGINT REFERENCES branches(branch_id),
    default_financial_year VARCHAR(20),
    default_screen      VARCHAR(120),
    notification_preference VARCHAR(40),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ,
    row_version     INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT uq_user_preferences UNIQUE (user_id, company_id)
);

-- 6.2 user_devices — registered devices (used by sessions & trust decisions)
CREATE TABLE user_devices (
    device_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    device_uuid     VARCHAR(100) NOT NULL,
    device_name     VARCHAR(150),
    manufacturer    VARCHAR(100),
    model           VARCHAR(100),
    os              VARCHAR(80),
    browser         VARCHAR(80),
    last_seen       TIMESTAMPTZ,
    is_trusted      BOOLEAN NOT NULL DEFAULT FALSE,
    is_blocked      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_devices UNIQUE (user_id, device_uuid)
);

-- 6.3 user_sessions — active/closed sessions (carries active company context)
CREATE TABLE user_sessions (
    session_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    company_id      BIGINT REFERENCES companies(company_id), -- active tenant in session
    device_id       BIGINT REFERENCES user_devices(device_id),
    login_time      TIMESTAMPTZ NOT NULL DEFAULT now(),
    logout_time     TIMESTAMPTZ,
    jwt_token       VARCHAR(1000),
    refresh_token   VARCHAR(500),
    browser         VARCHAR(80),
    browser_version VARCHAR(40),
    operating_system VARCHAR(80),
    device_type     VARCHAR(30),
    device_name     VARCHAR(150),
    ip_address      INET,
    country         VARCHAR(100),
    city            VARCHAR(100),
    latitude        NUMERIC(9,6),
    longitude       NUMERIC(9,6),
    session_status  VARCHAR(20) NOT NULL DEFAULT 'active' -- active|expired|revoked|logged_out
);

-- 6.4 user_login_history — audit trail of every login attempt
CREATE TABLE user_login_history (
    login_history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    company_id      BIGINT REFERENCES companies(company_id),
    login_date      TIMESTAMPTZ NOT NULL DEFAULT now(),
    login_result    VARCHAR(20) NOT NULL, -- success|failure
    failure_reason  VARCHAR(150),
    ip_address      INET,
    browser         VARCHAR(80),
    device          VARCHAR(120),
    country         VARCHAR(100),
    city            VARCHAR(100),
    session_duration INTEGER  -- seconds
);

-- 6.5 user_password_history — prevents password reuse
CREATE TABLE user_password_history (
    password_history_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    password_hash   VARCHAR(255) NOT NULL,
    password_salt   VARCHAR(255),
    hash_algorithm  VARCHAR(40),
    changed_date    TIMESTAMPTZ NOT NULL DEFAULT now(),
    changed_by      BIGINT
);

-- 6.6 user_api_keys — programmatic access tokens (optionally scoped to a tenant)
CREATE TABLE user_api_keys (
    api_key_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    company_id      BIGINT REFERENCES companies(company_id) ON DELETE CASCADE,
    name            VARCHAR(120),
    api_key         VARCHAR(120) NOT NULL UNIQUE,
    secret_hash     VARCHAR(255) NOT NULL,
    scope           VARCHAR(255),
    created_date    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expiry_date     TIMESTAMPTZ,
    last_used       TIMESTAMPTZ,
    status          VARCHAR(20) NOT NULL DEFAULT 'active' -- active|revoked|expired
);

-- 6.7 user_notifications — per-channel notification opt-in (1:1 with users)
CREATE TABLE user_notifications (
    notification_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
    email_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
    sms_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    push_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    teams_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    slack_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at      TIMESTAMPTZ
);

-- 6.8 user_signatures — invoice/approval/digital signatures & stamps
CREATE TABLE user_signatures (
    signature_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    company_id      BIGINT REFERENCES companies(company_id) ON DELETE CASCADE,
    signature_type  VARCHAR(40) NOT NULL, -- invoice|purchase|approval|digital_certificate|rubber_stamp
    image_path      VARCHAR(500),
    certificate_data TEXT,
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    valid_from      DATE,
    valid_to        DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ
);

-- 6.9 user_attachments — KYC / HR documents
CREATE TABLE user_attachments (
    attachment_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    company_id      BIGINT REFERENCES companies(company_id) ON DELETE CASCADE,
    document_type   VARCHAR(50) NOT NULL, -- passport|driving_license|contract|resume|certificate|nda|other
    file_name       VARCHAR(255),
    file_path       VARCHAR(500) NOT NULL,
    file_size       BIGINT,
    mime_type       VARCHAR(120),
    expiry_date     DATE,
    is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    uploaded_by     BIGINT,
    uploaded_date   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6.10 user_delegations — delegate authority to another user for a period
CREATE TABLE user_delegations (
    delegation_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,        -- delegator
    delegate_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,       -- delegatee
    company_id      BIGINT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    start_date      DATE NOT NULL,
    end_date        DATE,
    reason          VARCHAR(255),
    status          VARCHAR(20) NOT NULL DEFAULT 'active', -- active|expired|cancelled
    created_by      BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_delegation_diff CHECK (user_id <> delegate_user_id)
);

-- 6.11 user_consents — privacy/terms/NDA acceptance tracking
CREATE TABLE user_consents (
    consent_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    company_id      BIGINT REFERENCES companies(company_id) ON DELETE CASCADE,
    consent_type    VARCHAR(40) NOT NULL, -- privacy_policy|terms|nda
    consent_version VARCHAR(20) NOT NULL,
    is_accepted     BOOLEAN NOT NULL DEFAULT FALSE,
    accepted_date   TIMESTAMPTZ,
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6.12 user_audit — generic change log for user-related entities
CREATE TABLE user_audit (
    audit_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
    company_id      BIGINT REFERENCES companies(company_id),
    action          VARCHAR(40) NOT NULL,  -- create|update|delete|login|role_change ...
    entity_name     VARCHAR(80),
    entity_id       BIGINT,
    old_value       JSONB,
    new_value       JSONB,
    ip_address      INET,
    performed_by    BIGINT,
    performed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 7. INDEXES (tenant isolation + lookup performance)
-- ----------------------------------------------------------------------------
CREATE INDEX idx_company_subscriptions_company ON company_subscriptions(company_id);
CREATE INDEX idx_company_modules_company        ON company_modules(company_id);
CREATE INDEX idx_branches_company               ON branches(company_id);
CREATE INDEX idx_departments_company            ON departments(company_id);
CREATE INDEX idx_designations_company           ON designations(company_id);
CREATE INDEX idx_warehouses_company             ON warehouses(company_id);
CREATE INDEX idx_roles_company                  ON roles(company_id);
CREATE INDEX idx_permissions_module             ON permissions(module_id);
CREATE INDEX idx_role_permissions_role          ON role_permissions(role_id);
CREATE INDEX idx_user_companies_user            ON user_companies(user_id);
CREATE INDEX idx_user_companies_company         ON user_companies(company_id);
CREATE INDEX idx_user_roles_user_company        ON user_roles(user_id, company_id);
CREATE INDEX idx_user_module_access_user_company ON user_module_access(user_id, company_id);
CREATE INDEX idx_user_sessions_user             ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_status           ON user_sessions(session_status);
CREATE INDEX idx_user_login_history_user        ON user_login_history(user_id);
CREATE INDEX idx_user_devices_user              ON user_devices(user_id);
CREATE INDEX idx_user_api_keys_user             ON user_api_keys(user_id);
CREATE INDEX idx_user_audit_user                ON user_audit(user_id);
CREATE INDEX idx_user_audit_entity             ON user_audit(entity_name, entity_id);

COMMIT;

-- ============================================================================
--  END OF MIGRATION
-- ============================================================================
