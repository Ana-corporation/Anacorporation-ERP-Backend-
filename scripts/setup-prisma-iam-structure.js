/**
 * Creates prisma/iam/<table>/schema.prisma + validation.sql per table
 * Run once: node scripts/setup-prisma-iam-structure.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRISMA_IAM = path.join(ROOT, 'prisma', 'iam');

const TABLES = [
  { n: '001', folder: 'currencies', model: 'Currency', map: 'currencies' },
  { n: '002', folder: 'super_admins', model: 'SuperAdmin', map: 'super_admins' },
  { n: '003', folder: 'companies', model: 'Company', map: 'companies' },
  { n: '004', folder: 'subscription_plans', model: 'SubscriptionPlan', map: 'subscription_plans' },
  { n: '005', folder: 'modules', model: 'Module', map: 'modules' },
  { n: '006', folder: 'plan_modules', model: 'PlanModule', map: 'plan_modules' },
  { n: '007', folder: 'company_subscriptions', model: 'CompanySubscription', map: 'company_subscriptions' },
  { n: '008', folder: 'company_modules', model: 'CompanyModule', map: 'company_modules' },
  { n: '009', folder: 'company_security_policies', model: 'CompanySecurityPolicy', map: 'company_security_policies' },
  { n: '010', folder: 'branches', model: 'Branch', map: 'branches' },
  { n: '011', folder: 'departments', model: 'Department', map: 'departments' },
  { n: '012', folder: 'designations', model: 'Designation', map: 'designations' },
  { n: '013', folder: 'warehouses', model: 'Warehouse', map: 'warehouses' },
  { n: '014', folder: 'roles', model: 'Role', map: 'roles' },
  { n: '015', folder: 'permissions', model: 'Permission', map: 'permissions' },
  { n: '016', folder: 'role_permissions', model: 'RolePermission', map: 'role_permissions' },
  { n: '017', folder: 'users', model: 'User', map: 'users' },
  { n: '018', folder: 'user_authentication', model: 'UserAuthentication', map: 'user_authentication' },
  { n: '019', folder: 'user_mfa', model: 'UserMfa', map: 'user_mfa' },
  { n: '020', folder: 'user_companies', model: 'UserCompany', map: 'user_companies' },
  { n: '021', folder: 'user_roles', model: 'UserRole', map: 'user_roles' },
  { n: '022', folder: 'user_module_access', model: 'UserModuleAccess', map: 'user_module_access' },
  { n: '023', folder: 'user_preferences', model: 'UserPreference', map: 'user_preferences' },
  { n: '024', folder: 'user_devices', model: 'UserDevice', map: 'user_devices' },
  { n: '025', folder: 'user_sessions', model: 'UserSession', map: 'user_sessions' },
  { n: '026', folder: 'user_login_history', model: 'UserLoginHistory', map: 'user_login_history' },
  { n: '027', folder: 'user_password_history', model: 'UserPasswordHistory', map: 'user_password_history' },
  { n: '028', folder: 'user_api_keys', model: 'UserApiKey', map: 'user_api_keys' },
  { n: '029', folder: 'user_notifications', model: 'UserNotification', map: 'user_notifications' },
  { n: '030', folder: 'user_signatures', model: 'UserSignature', map: 'user_signatures' },
  { n: '031', folder: 'user_attachments', model: 'UserAttachment', map: 'user_attachments' },
  { n: '032', folder: 'user_delegations', model: 'UserDelegation', map: 'user_delegations' },
  { n: '033', folder: 'user_consents', model: 'UserConsent', map: 'user_consents' },
  { n: '034', folder: 'user_audit', model: 'UserAudit', map: 'user_audit' },
];

// Full Prisma model bodies (relations included)
const MODELS = {
  Currency: `model Currency {
  currencyId    BigInt    @id @default(autoincrement()) @map("currency_id")
  code          String    @unique @db.VarChar(3)
  name          String    @db.VarChar(100)
  symbol        String?   @db.VarChar(8)
  decimalPlaces Int       @default(2) @map("decimal_places") @db.SmallInt
  isActive      Boolean   @default(true) @map("is_active")
  createdBy     BigInt?   @map("created_by")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedBy     BigInt?   @map("updated_by")
  updatedAt     DateTime? @map("updated_at")
  deletedBy     BigInt?   @map("deleted_by")
  deletedAt     DateTime? @map("deleted_at")
  rowVersion    Int       @default(1) @map("row_version")

  companies            Company[]
  userCompaniesDefault UserCompany[] @relation("UserCompanyDefaultCurrency")

  @@map("currencies")
}`,

  SuperAdmin: `model SuperAdmin {
  superAdminId  BigInt    @id @default(autoincrement()) @map("super_admin_id")
  name          String    @db.VarChar(150)
  email         String    @unique @db.VarChar(255)
  passwordHash  String    @map("password_hash") @db.VarChar(255)
  isMfaEnabled  Boolean   @default(false) @map("is_mfa_enabled")
  mfaSecret     String?   @map("mfa_secret") @db.VarChar(255)
  isActive      Boolean   @default(true) @map("is_active")
  lastLoginAt   DateTime? @map("last_login_at")
  createdBy     BigInt?   @map("created_by")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedBy     BigInt?   @map("updated_by")
  updatedAt     DateTime? @map("updated_at")
  deletedBy     BigInt?   @map("deleted_by")
  deletedAt     DateTime? @map("deleted_at")
  rowVersion    Int       @default(1) @map("row_version")

  @@map("super_admins")
}`,

  Company: `model Company {
  companyId         BigInt        @id @default(autoincrement()) @map("company_id")
  companyCode       String        @unique @map("company_code") @db.VarChar(30)
  name              String        @db.VarChar(200)
  legalName         String?       @map("legal_name") @db.VarChar(255)
  domain            String?       @unique @db.VarChar(255)
  email             String?       @db.VarChar(255)
  phone             String?       @db.VarChar(30)
  taxNumber         String?       @map("tax_number") @db.VarChar(50)
  addressLine1      String?       @map("address_line1") @db.VarChar(255)
  addressLine2      String?       @map("address_line2") @db.VarChar(255)
  city              String?       @db.VarChar(100)
  state             String?       @db.VarChar(100)
  country           String?       @db.VarChar(100)
  postalCode        String?       @map("postal_code") @db.VarChar(20)
  timezone          String        @default("UTC") @db.VarChar(60)
  defaultCurrencyId BigInt?       @map("default_currency_id")
  logoUrl           String?       @map("logo_url") @db.VarChar(500)
  status            CompanyStatus @default(trial)
  createdBy         BigInt?       @map("created_by")
  createdAt         DateTime      @default(now()) @map("created_at")
  updatedBy         BigInt?       @map("updated_by")
  updatedAt         DateTime?     @map("updated_at")
  deletedBy         BigInt?       @map("deleted_by")
  deletedAt         DateTime?     @map("deleted_at")
  rowVersion        Int           @default(1) @map("row_version")

  defaultCurrency     Currency?              @relation(fields: [defaultCurrencyId], references: [currencyId])
  subscriptions       CompanySubscription[]
  companyModules      CompanyModule[]
  securityPolicy      CompanySecurityPolicy?
  branches            Branch[]
  departments         Department[]
  designations        Designation[]
  warehouses          Warehouse[]
  roles               Role[]
  userCompanies       UserCompany[]
  userRoles           UserRole[]
  userModuleAccess    UserModuleAccess[]
  userPreferences     UserPreference[]
  userSessions        UserSession[]
  userLoginHistory    UserLoginHistory[]
  userApiKeys         UserApiKey[]
  userSignatures      UserSignature[]
  userAttachments     UserAttachment[]
  userDelegations     UserDelegation[]
  userConsents        UserConsent[]
  userAudits          UserAudit[]

  @@map("companies")
}`,

  SubscriptionPlan: `model SubscriptionPlan {
  planId        BigInt       @id @default(autoincrement()) @map("plan_id")
  planCode      String       @unique @map("plan_code") @db.VarChar(30)
  name          String       @db.VarChar(100)
  description   String?
  price         Decimal      @default(0) @db.Decimal(12, 2)
  billingCycle  BillingCycle @default(monthly) @map("billing_cycle")
  maxUsers      Int?         @map("max_users")
  maxStorageGb  Int?         @map("max_storage_gb")
  isActive      Boolean      @default(true) @map("is_active")
  createdBy     BigInt?      @map("created_by")
  createdAt     DateTime     @default(now()) @map("created_at")
  updatedBy     BigInt?      @map("updated_by")
  updatedAt     DateTime?    @map("updated_at")
  deletedBy     BigInt?      @map("deleted_by")
  deletedAt     DateTime?    @map("deleted_at")
  rowVersion    Int          @default(1) @map("row_version")

  planModules   PlanModule[]
  subscriptions CompanySubscription[]

  @@map("subscription_plans")
}`,

  Module: `model Module {
  moduleId       BigInt    @id @default(autoincrement()) @map("module_id")
  moduleCode     String    @unique @map("module_code") @db.VarChar(40)
  moduleName     String    @map("module_name") @db.VarChar(120)
  description    String?
  icon           String?   @db.VarChar(80)
  parentModuleId BigInt?   @map("parent_module_id")
  sortOrder      Int       @default(0) @map("sort_order")
  isActive       Boolean   @default(true) @map("is_active")
  createdBy      BigInt?   @map("created_by")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedBy      BigInt?   @map("updated_by")
  updatedAt      DateTime? @map("updated_at")
  deletedBy      BigInt?   @map("deleted_by")
  deletedAt      DateTime? @map("deleted_at")
  rowVersion     Int       @default(1) @map("row_version")

  parent           Module?            @relation("ModuleHierarchy", fields: [parentModuleId], references: [moduleId])
  children         Module[]           @relation("ModuleHierarchy")
  planModules      PlanModule[]
  companyModules   CompanyModule[]
  permissions      Permission[]
  rolePermissions  RolePermission[]
  userModuleAccess UserModuleAccess[]

  @@map("modules")
}`,

  PlanModule: `model PlanModule {
  planModuleId BigInt   @id @default(autoincrement()) @map("plan_module_id")
  planId       BigInt   @map("plan_id")
  moduleId     BigInt   @map("module_id")
  createdAt    DateTime @default(now()) @map("created_at")

  plan   SubscriptionPlan @relation(fields: [planId], references: [planId], onDelete: Cascade)
  module Module           @relation(fields: [moduleId], references: [moduleId], onDelete: Cascade)

  @@unique([planId, moduleId])
  @@map("plan_modules")
}`,

  CompanySubscription: `model CompanySubscription {
  companySubscriptionId BigInt             @id @default(autoincrement()) @map("company_subscription_id")
  companyId             BigInt             @map("company_id")
  planId                BigInt             @map("plan_id")
  startDate             DateTime           @map("start_date") @db.Date
  endDate               DateTime?          @map("end_date") @db.Date
  billingCycle          BillingCycle       @default(monthly) @map("billing_cycle")
  amount                Decimal            @default(0) @db.Decimal(12, 2)
  autoRenew             Boolean            @default(true) @map("auto_renew")
  status                SubscriptionStatus @default(pending)
  createdBy             BigInt?            @map("created_by")
  createdAt             DateTime           @default(now()) @map("created_at")
  updatedBy             BigInt?            @map("updated_by")
  updatedAt             DateTime?          @map("updated_at")
  deletedBy             BigInt?            @map("deleted_by")
  deletedAt             DateTime?          @map("deleted_at")
  rowVersion            Int                @default(1) @map("row_version")

  company Company          @relation(fields: [companyId], references: [companyId], onDelete: Cascade)
  plan    SubscriptionPlan @relation(fields: [planId], references: [planId])

  @@index([companyId])
  @@map("company_subscriptions")
}`,

  CompanyModule: `model CompanyModule {
  companyModuleId BigInt    @id @default(autoincrement()) @map("company_module_id")
  companyId       BigInt    @map("company_id")
  moduleId        BigInt    @map("module_id")
  isActive        Boolean   @default(true) @map("is_active")
  activatedDate   DateTime  @default(now()) @map("activated_date") @db.Date
  expiryDate      DateTime? @map("expiry_date") @db.Date
  createdBy       BigInt?   @map("created_by")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedBy       BigInt?   @map("updated_by")
  updatedAt       DateTime? @map("updated_at")
  deletedBy       BigInt?   @map("deleted_by")
  deletedAt       DateTime? @map("deleted_at")
  rowVersion      Int       @default(1) @map("row_version")

  company Company @relation(fields: [companyId], references: [companyId], onDelete: Cascade)
  module  Module  @relation(fields: [moduleId], references: [moduleId])

  @@unique([companyId, moduleId])
  @@index([companyId])
  @@map("company_modules")
}`,

  CompanySecurityPolicy: `model CompanySecurityPolicy {
  policyId              BigInt      @id @default(autoincrement()) @map("policy_id")
  companyId             BigInt      @unique @map("company_id")
  passwordExpiryDays    Int?        @default(90) @map("password_expiry_days")
  passwordNeverExpires  Boolean     @default(false) @map("password_never_expires")
  forcePasswordRotation Boolean     @default(false) @map("force_password_rotation")
  minPasswordLength     Int         @default(8) @map("min_password_length") @db.SmallInt
  requireStrongPassword Boolean     @default(true) @map("require_strong_password")
  requireMfa            Boolean     @default(false) @map("require_mfa")
  maxLoginAttempts      Int         @default(5) @map("max_login_attempts") @db.SmallInt
  lockoutDurationMin    Int         @default(30) @map("lockout_duration_min")
  allowMultipleLogins   Boolean     @default(true) @map("allow_multiple_logins")
  maxConcurrentSessions Int?        @map("max_concurrent_sessions") @db.SmallInt
  sessionTimeoutMin     Int         @default(60) @map("session_timeout_min")
  licenseType           LicenseType @default(named) @map("license_type")
  totalLicenses         Int?        @map("total_licenses")
  createdBy             BigInt?     @map("created_by")
  createdAt             DateTime    @default(now()) @map("created_at")
  updatedBy             BigInt?     @map("updated_by")
  updatedAt             DateTime?   @map("updated_at")
  rowVersion            Int         @default(1) @map("row_version")

  company Company @relation(fields: [companyId], references: [companyId], onDelete: Cascade)

  @@map("company_security_policies")
}`,

  Branch: `model Branch {
  branchId   BigInt    @id @default(autoincrement()) @map("branch_id")
  companyId  BigInt    @map("company_id")
  branchCode String    @map("branch_code") @db.VarChar(30)
  name       String    @db.VarChar(150)
  address    String?   @db.VarChar(255)
  city       String?   @db.VarChar(100)
  country    String?   @db.VarChar(100)
  phone      String?   @db.VarChar(30)
  isActive   Boolean   @default(true) @map("is_active")
  createdBy  BigInt?   @map("created_by")
  createdAt  DateTime  @default(now()) @map("created_at")
  updatedBy  BigInt?   @map("updated_by")
  updatedAt  DateTime? @map("updated_at")
  deletedBy  BigInt?   @map("deleted_by")
  deletedAt  DateTime? @map("deleted_at")
  rowVersion Int       @default(1) @map("row_version")

  company         Company          @relation(fields: [companyId], references: [companyId], onDelete: Cascade)
  warehouses      Warehouse[]
  userCompanies   UserCompany[]
  userPreferences UserPreference[]

  @@unique([companyId, branchCode])
  @@index([companyId])
  @@map("branches")
}`,

  Department: `model Department {
  departmentId       BigInt    @id @default(autoincrement()) @map("department_id")
  companyId          BigInt    @map("company_id")
  departmentCode     String    @map("department_code") @db.VarChar(30)
  name               String    @db.VarChar(150)
  parentDepartmentId BigInt?   @map("parent_department_id")
  isActive           Boolean   @default(true) @map("is_active")
  createdBy          BigInt?   @map("created_by")
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedBy          BigInt?   @map("updated_by")
  updatedAt          DateTime? @map("updated_at")
  deletedBy          BigInt?   @map("deleted_by")
  deletedAt          DateTime? @map("deleted_at")
  rowVersion         Int       @default(1) @map("row_version")

  company        Company      @relation(fields: [companyId], references: [companyId], onDelete: Cascade)
  parent         Department?  @relation("DepartmentHierarchy", fields: [parentDepartmentId], references: [departmentId])
  children       Department[] @relation("DepartmentHierarchy")
  userCompanies  UserCompany[]

  @@unique([companyId, departmentCode])
  @@index([companyId])
  @@map("departments")
}`,

  Designation: `model Designation {
  designationId   BigInt    @id @default(autoincrement()) @map("designation_id")
  companyId       BigInt    @map("company_id")
  designationCode String    @map("designation_code") @db.VarChar(30)
  name            String    @db.VarChar(150)
  gradeLevel      Int?      @map("grade_level") @db.SmallInt
  isActive        Boolean   @default(true) @map("is_active")
  createdBy       BigInt?   @map("created_by")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedBy       BigInt?   @map("updated_by")
  updatedAt       DateTime? @map("updated_at")
  deletedBy       BigInt?   @map("deleted_by")
  deletedAt       DateTime? @map("deleted_at")
  rowVersion      Int       @default(1) @map("row_version")

  company       Company       @relation(fields: [companyId], references: [companyId], onDelete: Cascade)
  userCompanies UserCompany[]

  @@unique([companyId, designationCode])
  @@index([companyId])
  @@map("designations")
}`,

  Warehouse: `model Warehouse {
  warehouseId   BigInt    @id @default(autoincrement()) @map("warehouse_id")
  companyId     BigInt    @map("company_id")
  branchId      BigInt?   @map("branch_id")
  warehouseCode String    @map("warehouse_code") @db.VarChar(30)
  name          String    @db.VarChar(150)
  address       String?   @db.VarChar(255)
  isActive      Boolean   @default(true) @map("is_active")
  createdBy     BigInt?   @map("created_by")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedBy     BigInt?   @map("updated_by")
  updatedAt     DateTime? @map("updated_at")
  deletedBy     BigInt?   @map("deleted_by")
  deletedAt     DateTime? @map("deleted_at")
  rowVersion    Int       @default(1) @map("row_version")

  company              Company          @relation(fields: [companyId], references: [companyId], onDelete: Cascade)
  branch               Branch?          @relation(fields: [branchId], references: [branchId])
  userCompanies        UserCompany[]
  userPreferences      UserPreference[]

  @@unique([companyId, warehouseCode])
  @@index([companyId])
  @@map("warehouses")
}`,

  Role: `model Role {
  roleId      BigInt    @id @default(autoincrement()) @map("role_id")
  companyId   BigInt?   @map("company_id")
  roleCode    String    @map("role_code") @db.VarChar(40)
  roleName    String    @map("role_name") @db.VarChar(120)
  description String?
  isSystem    Boolean   @default(false) @map("is_system")
  isTemplate  Boolean   @default(false) @map("is_template")
  createdBy   BigInt?   @map("created_by")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedBy   BigInt?   @map("updated_by")
  updatedAt   DateTime? @map("updated_at")
  deletedBy   BigInt?   @map("deleted_by")
  deletedAt   DateTime? @map("deleted_at")
  rowVersion  Int       @default(1) @map("row_version")

  company         Company?         @relation(fields: [companyId], references: [companyId], onDelete: Cascade)
  rolePermissions RolePermission[]
  userRoles       UserRole[]

  @@unique([companyId, roleCode])
  @@index([companyId])
  @@map("roles")
}`,

  Permission: `model Permission {
  permissionId   BigInt           @id @default(autoincrement()) @map("permission_id")
  moduleId       BigInt           @map("module_id")
  permissionCode String           @map("permission_code") @db.VarChar(60)
  permissionName String           @map("permission_name") @db.VarChar(120)
  action         PermissionAction
  createdAt      DateTime         @default(now()) @map("created_at")

  module          Module           @relation(fields: [moduleId], references: [moduleId], onDelete: Cascade)
  rolePermissions RolePermission[]

  @@unique([moduleId, permissionCode])
  @@index([moduleId])
  @@map("permissions")
}`,

  RolePermission: `model RolePermission {
  rolePermissionId BigInt   @id @default(autoincrement()) @map("role_permission_id")
  roleId           BigInt   @map("role_id")
  moduleId         BigInt   @map("module_id")
  permissionId     BigInt   @map("permission_id")
  isAllowed        Boolean  @default(true) @map("is_allowed")
  createdBy        BigInt?  @map("created_by")
  createdAt        DateTime @default(now()) @map("created_at")

  role       Role       @relation(fields: [roleId], references: [roleId], onDelete: Cascade)
  module     Module     @relation(fields: [moduleId], references: [moduleId], onDelete: Cascade)
  permission Permission @relation(fields: [permissionId], references: [permissionId], onDelete: Cascade)

  @@unique([roleId, permissionId])
  @@index([roleId])
  @@map("role_permissions")
}`,

  User: `model User {
  userId          BigInt    @id @default(autoincrement()) @map("user_id")
  userCode        String?   @unique @map("user_code") @db.VarChar(40)
  username        String    @unique @db.VarChar(100)
  displayName     String?   @map("display_name") @db.VarChar(200)
  firstName       String?   @map("first_name") @db.VarChar(100)
  middleName      String?   @map("middle_name") @db.VarChar(100)
  lastName        String?   @map("last_name") @db.VarChar(100)
  preferredName   String?   @map("preferred_name") @db.VarChar(100)
  gender          Gender?
  dateOfBirth     DateTime? @map("date_of_birth") @db.Date
  email           String    @unique @db.VarChar(255)
  secondaryEmail  String?   @map("secondary_email") @db.VarChar(255)
  mobile          String?   @db.VarChar(30)
  alternateMobile String?   @map("alternate_mobile") @db.VarChar(30)
  countryCode     String?   @map("country_code") @db.VarChar(8)
  languageCode    String    @default("en") @map("language_code") @db.VarChar(10)
  timeZone        String    @default("UTC") @map("time_zone") @db.VarChar(60)
  cultureCode     String?   @map("culture_code") @db.VarChar(15)
  profilePhoto    String?   @map("profile_photo") @db.VarChar(500)
  signatureImage  String?   @map("signature_image") @db.VarChar(500)
  isActive        Boolean   @default(true) @map("is_active")
  isLocked        Boolean   @default(false) @map("is_locked")
  lockReason      String?   @map("lock_reason") @db.VarChar(255)
  remarks         String?
  createdBy       BigInt?   @map("created_by")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedBy       BigInt?   @map("updated_by")
  updatedAt       DateTime? @map("updated_at")
  deletedBy       BigInt?   @map("deleted_by")
  deletedAt       DateTime? @map("deleted_at")
  rowVersion      Int       @default(1) @map("row_version")

  authentication   UserAuthentication?
  mfaMethods       UserMfa[]
  companies        UserCompany[]
  roles            UserRole[]
  moduleAccess     UserModuleAccess[]
  preferences      UserPreference[]
  devices          UserDevice[]
  sessions         UserSession[]
  loginHistory     UserLoginHistory[]
  passwordHistory  UserPasswordHistory[]
  apiKeys          UserApiKey[]
  notifications    UserNotification?
  signatures       UserSignature[]
  attachments      UserAttachment[]
  delegations      UserDelegation[]      @relation("Delegator")
  delegatedTo      UserDelegation[]      @relation("Delegatee")
  consents         UserConsent[]
  audits           UserAudit[]

  @@index([deletedAt])
  @@map("users")
}`,

  UserAuthentication: `model UserAuthentication {
  authenticationId      BigInt        @id @default(autoincrement()) @map("authentication_id")
  userId                BigInt        @unique @map("user_id")
  passwordHash          String        @map("password_hash") @db.VarChar(255)
  passwordSalt          String?       @map("password_salt") @db.VarChar(255)
  hashAlgorithm         HashAlgorithm @default(bcrypt) @map("hash_algorithm")
  passwordVersion       Int?          @default(1) @map("password_version")
  passwordChangedDate   DateTime?     @map("password_changed_date")
  passwordExpiresDate   DateTime?     @map("password_expires_date")
  passwordNeverExpires  Boolean       @default(false) @map("password_never_expires")
  mustChangePassword    Boolean       @default(false) @map("must_change_password")
  accountExpirationDate DateTime?     @map("account_expiration_date")
  failedLoginCount      Int           @default(0) @map("failed_login_count") @db.SmallInt
  lastFailedLogin       DateTime?     @map("last_failed_login")
  lastSuccessfulLogin   DateTime?     @map("last_successful_login")
  lastPasswordReset     DateTime?     @map("last_password_reset")
  securityStamp         String?       @map("security_stamp") @db.VarChar(100)
  refreshToken          String?       @map("refresh_token") @db.VarChar(500)
  refreshTokenExpiry    DateTime?     @map("refresh_token_expiry")
  accountLockedUntil    DateTime?     @map("account_locked_until")
  isMfaEnabled          Boolean       @default(false) @map("is_mfa_enabled")
  mfaType               MfaType?      @map("mfa_type")
  otpSecret             String?       @map("otp_secret") @db.VarChar(255)
  recoveryCodes         String?       @map("recovery_codes")
  isEmailVerified       Boolean       @default(false) @map("is_email_verified")
  isPhoneVerified       Boolean       @default(false) @map("is_phone_verified")
  createdAt             DateTime      @default(now()) @map("created_at")
  updatedAt             DateTime?     @map("updated_at")
  rowVersion            Int           @default(1) @map("row_version")

  user User @relation(fields: [userId], references: [userId], onDelete: Cascade)

  @@map("user_authentication")
}`,

  UserMfa: `model UserMfa {
  userMfaId     BigInt    @id @default(autoincrement()) @map("user_mfa_id")
  userId        BigInt    @map("user_id")
  mfaType       MfaType   @map("mfa_type")
  secret        String?   @db.VarChar(255)
  phone         String?   @db.VarChar(30)
  email         String?   @db.VarChar(255)
  isPrimary     Boolean   @default(false) @map("is_primary")
  isEnabled     Boolean   @default(true) @map("is_enabled")
  verifiedAt    DateTime? @map("verified_at")
  recoveryCodes String?   @map("recovery_codes")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime? @map("updated_at")

  user User @relation(fields: [userId], references: [userId], onDelete: Cascade)

  @@index([userId])
  @@map("user_mfa")
}`,

  UserCompany: `model UserCompany {
  userCompanyId     BigInt           @id @default(autoincrement()) @map("user_company_id")
  userId            BigInt           @map("user_id")
  companyId         BigInt           @map("company_id")
  employeeId        String?          @map("employee_id") @db.VarChar(40)
  departmentId      BigInt?          @map("department_id")
  designationId     BigInt?          @map("designation_id")
  branchId          BigInt?          @map("branch_id")
  warehouseId       BigInt?          @map("warehouse_id")
  defaultCurrencyId BigInt?          @map("default_currency_id")
  licenseType       LicenseType      @default(named) @map("license_type")
  isDefault         Boolean          @default(false) @map("is_default")
  hireDate          DateTime?        @map("hire_date") @db.Date
  exitDate          DateTime?        @map("exit_date") @db.Date
  status            MembershipStatus @default(invited)
  createdBy         BigInt?          @map("created_by")
  createdAt         DateTime         @default(now()) @map("created_at")
  updatedBy         BigInt?          @map("updated_by")
  updatedAt         DateTime?        @map("updated_at")
  deletedBy         BigInt?          @map("deleted_by")
  deletedAt         DateTime?        @map("deleted_at")
  rowVersion        Int              @default(1) @map("row_version")

  user            User         @relation(fields: [userId], references: [userId], onDelete: Cascade)
  company         Company      @relation(fields: [companyId], references: [companyId], onDelete: Cascade)
  department      Department?  @relation(fields: [departmentId], references: [departmentId])
  designation     Designation? @relation(fields: [designationId], references: [designationId])
  branch          Branch?      @relation(fields: [branchId], references: [branchId])
  warehouse       Warehouse?   @relation(fields: [warehouseId], references: [warehouseId])
  defaultCurrency Currency?    @relation("UserCompanyDefaultCurrency", fields: [defaultCurrencyId], references: [currencyId])

  @@unique([userId, companyId])
  @@index([userId])
  @@index([companyId])
  @@map("user_companies")
}`,

  UserRole: `model UserRole {
  userRoleId   BigInt    @id @default(autoincrement()) @map("user_role_id")
  userId       BigInt    @map("user_id")
  companyId    BigInt    @map("company_id")
  roleId       BigInt    @map("role_id")
  assignedBy   BigInt?   @map("assigned_by")
  assignedDate DateTime  @default(now()) @map("assigned_date")
  validUntil   DateTime? @map("valid_until")
  isActive     Boolean   @default(true) @map("is_active")
  createdAt    DateTime  @default(now()) @map("created_at")
  rowVersion   Int       @default(1) @map("row_version")

  user    User    @relation(fields: [userId], references: [userId], onDelete: Cascade)
  company Company @relation(fields: [companyId], references: [companyId], onDelete: Cascade)
  role    Role    @relation(fields: [roleId], references: [roleId], onDelete: Cascade)

  @@unique([userId, companyId, roleId])
  @@index([userId, companyId])
  @@map("user_roles")
}`,

  UserModuleAccess: `model UserModuleAccess {
  userModuleAccessId BigInt           @id @default(autoincrement()) @map("user_module_access_id")
  userId             BigInt           @map("user_id")
  companyId          BigInt           @map("company_id")
  moduleId           BigInt           @map("module_id")
  accessType         ModuleAccessType @default(grant) @map("access_type")
  reason             String?          @db.VarChar(255)
  expiryDate         DateTime?        @map("expiry_date") @db.Date
  createdBy          BigInt?          @map("created_by")
  createdAt          DateTime         @default(now()) @map("created_at")
  rowVersion         Int              @default(1) @map("row_version")

  user    User    @relation(fields: [userId], references: [userId], onDelete: Cascade)
  company Company @relation(fields: [companyId], references: [companyId], onDelete: Cascade)
  module  Module  @relation(fields: [moduleId], references: [moduleId], onDelete: Cascade)

  @@unique([userId, companyId, moduleId])
  @@index([userId, companyId])
  @@map("user_module_access")
}`,

  UserPreference: `model UserPreference {
  preferenceId          BigInt    @id @default(autoincrement()) @map("preference_id")
  userId                BigInt    @map("user_id")
  companyId             BigInt?   @map("company_id")
  theme                 Theme     @default(light)
  accentColor           String?   @map("accent_color") @db.VarChar(20)
  language              String    @default("en") @db.VarChar(10)
  dashboardLayout       String?   @map("dashboard_layout") @db.VarChar(40)
  homePage              String?   @map("home_page") @db.VarChar(120)
  menuStyle             String?   @map("menu_style") @db.VarChar(30)
  fontSize              String?   @map("font_size") @db.VarChar(20)
  density               String?   @db.VarChar(20)
  dateFormat            String    @default("yyyy-MM-dd") @map("date_format") @db.VarChar(30)
  timeFormat            String    @default("HH:mm") @map("time_format") @db.VarChar(20)
  numberFormat          String?   @map("number_format") @db.VarChar(30)
  currencyFormat        String?   @map("currency_format") @db.VarChar(30)
  defaultPrinter        String?   @map("default_printer") @db.VarChar(120)
  defaultReportFormat   String?   @map("default_report_format") @db.VarChar(20)
  defaultWarehouseId    BigInt?   @map("default_warehouse_id")
  defaultBranchId       BigInt?   @map("default_branch_id")
  defaultFinancialYear  String?   @map("default_financial_year") @db.VarChar(20)
  defaultScreen         String?   @map("default_screen") @db.VarChar(120)
  notificationPreference String?  @map("notification_preference") @db.VarChar(40)
  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime? @map("updated_at")
  rowVersion            Int       @default(1) @map("row_version")

  user              User       @relation(fields: [userId], references: [userId], onDelete: Cascade)
  company           Company?   @relation(fields: [companyId], references: [companyId], onDelete: Cascade)
  defaultWarehouse  Warehouse? @relation(fields: [defaultWarehouseId], references: [warehouseId])
  defaultBranch     Branch?    @relation(fields: [defaultBranchId], references: [branchId])

  @@unique([userId, companyId])
  @@map("user_preferences")
}`,

  UserDevice: `model UserDevice {
  deviceId     BigInt    @id @default(autoincrement()) @map("device_id")
  userId       BigInt    @map("user_id")
  deviceUuid   String    @map("device_uuid") @db.VarChar(100)
  deviceName   String?   @map("device_name") @db.VarChar(150)
  manufacturer String?   @db.VarChar(100)
  model        String?   @db.VarChar(100)
  os           String?   @db.VarChar(80)
  browser      String?   @db.VarChar(80)
  lastSeen     DateTime? @map("last_seen")
  isTrusted    Boolean   @default(false) @map("is_trusted")
  isBlocked    Boolean   @default(false) @map("is_blocked")
  createdAt    DateTime  @default(now()) @map("created_at")

  user     User          @relation(fields: [userId], references: [userId], onDelete: Cascade)
  sessions UserSession[]

  @@unique([userId, deviceUuid])
  @@index([userId])
  @@map("user_devices")
}`,

  UserSession: `model UserSession {
  sessionId       BigInt        @id @default(autoincrement()) @map("session_id")
  userId          BigInt        @map("user_id")
  companyId       BigInt?       @map("company_id")
  deviceId        BigInt?       @map("device_id")
  loginTime       DateTime      @default(now()) @map("login_time")
  logoutTime      DateTime?     @map("logout_time")
  jwtToken        String?       @map("jwt_token") @db.VarChar(1000)
  refreshToken    String?       @map("refresh_token") @db.VarChar(500)
  browser         String?       @db.VarChar(80)
  browserVersion  String?       @map("browser_version") @db.VarChar(40)
  operatingSystem String?       @map("operating_system") @db.VarChar(80)
  deviceType      String?       @map("device_type") @db.VarChar(30)
  deviceName      String?       @map("device_name") @db.VarChar(150)
  ipAddress       String?       @map("ip_address")
  country         String?       @db.VarChar(100)
  city            String?       @db.VarChar(100)
  latitude        Decimal?      @db.Decimal(9, 6)
  longitude       Decimal?      @db.Decimal(9, 6)
  sessionStatus   SessionStatus @default(active) @map("session_status")

  user    User        @relation(fields: [userId], references: [userId], onDelete: Cascade)
  company Company?    @relation(fields: [companyId], references: [companyId])
  device  UserDevice? @relation(fields: [deviceId], references: [deviceId])

  @@index([userId])
  @@index([sessionStatus])
  @@map("user_sessions")
}`,

  UserLoginHistory: `model UserLoginHistory {
  loginHistoryId  BigInt      @id @default(autoincrement()) @map("login_history_id")
  userId          BigInt?     @map("user_id")
  companyId       BigInt?     @map("company_id")
  loginDate       DateTime    @default(now()) @map("login_date")
  loginResult     LoginResult @map("login_result")
  failureReason   String?     @map("failure_reason") @db.VarChar(150)
  ipAddress       String?     @map("ip_address")
  browser         String?     @db.VarChar(80)
  device          String?     @db.VarChar(120)
  country         String?     @db.VarChar(100)
  city            String?     @db.VarChar(100)
  sessionDuration Int?        @map("session_duration")

  user    User?    @relation(fields: [userId], references: [userId], onDelete: SetNull)
  company Company? @relation(fields: [companyId], references: [companyId])

  @@index([userId])
  @@map("user_login_history")
}`,

  UserPasswordHistory: `model UserPasswordHistory {
  passwordHistoryId BigInt    @id @default(autoincrement()) @map("password_history_id")
  userId            BigInt    @map("user_id")
  passwordHash      String    @map("password_hash") @db.VarChar(255)
  passwordSalt      String?   @map("password_salt") @db.VarChar(255)
  hashAlgorithm     String?   @map("hash_algorithm") @db.VarChar(40)
  changedDate       DateTime  @default(now()) @map("changed_date")
  changedBy         BigInt?   @map("changed_by")

  user User @relation(fields: [userId], references: [userId], onDelete: Cascade)

  @@index([userId])
  @@map("user_password_history")
}`,

  UserApiKey: `model UserApiKey {
  apiKeyId    BigInt       @id @default(autoincrement()) @map("api_key_id")
  userId      BigInt       @map("user_id")
  companyId   BigInt?      @map("company_id")
  name        String?      @db.VarChar(120)
  apiKey      String       @unique @map("api_key") @db.VarChar(120)
  secretHash  String       @map("secret_hash") @db.VarChar(255)
  scope       String?      @db.VarChar(255)
  createdDate DateTime     @default(now()) @map("created_date")
  expiryDate  DateTime?    @map("expiry_date")
  lastUsed    DateTime?    @map("last_used")
  status      ApiKeyStatus @default(active)

  user    User     @relation(fields: [userId], references: [userId], onDelete: Cascade)
  company Company? @relation(fields: [companyId], references: [companyId], onDelete: Cascade)

  @@index([userId])
  @@map("user_api_keys")
}`,

  UserNotification: `model UserNotification {
  notificationId  BigInt    @id @default(autoincrement()) @map("notification_id")
  userId          BigInt    @unique @map("user_id")
  emailEnabled    Boolean   @default(true) @map("email_enabled")
  smsEnabled      Boolean   @default(false) @map("sms_enabled")
  whatsappEnabled Boolean   @default(false) @map("whatsapp_enabled")
  pushEnabled     Boolean   @default(true) @map("push_enabled")
  teamsEnabled    Boolean   @default(false) @map("teams_enabled")
  slackEnabled    Boolean   @default(false) @map("slack_enabled")
  updatedAt       DateTime? @map("updated_at")

  user User @relation(fields: [userId], references: [userId], onDelete: Cascade)

  @@map("user_notifications")
}`,

  UserSignature: `model UserSignature {
  signatureId     BigInt        @id @default(autoincrement()) @map("signature_id")
  userId          BigInt        @map("user_id")
  companyId       BigInt?       @map("company_id")
  signatureType   SignatureType @map("signature_type")
  imagePath       String?       @map("image_path") @db.VarChar(500)
  certificateData String?       @map("certificate_data")
  isDefault       Boolean       @default(false) @map("is_default")
  validFrom       DateTime?     @map("valid_from") @db.Date
  validTo         DateTime?     @map("valid_to") @db.Date
  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime?     @map("updated_at")

  user    User     @relation(fields: [userId], references: [userId], onDelete: Cascade)
  company Company? @relation(fields: [companyId], references: [companyId], onDelete: Cascade)

  @@map("user_signatures")
}`,

  UserAttachment: `model UserAttachment {
  attachmentId BigInt       @id @default(autoincrement()) @map("attachment_id")
  userId       BigInt       @map("user_id")
  companyId    BigInt?      @map("company_id")
  documentType DocumentType @map("document_type")
  fileName     String?      @map("file_name") @db.VarChar(255)
  filePath     String       @map("file_path") @db.VarChar(500)
  fileSize     BigInt?      @map("file_size")
  mimeType     String?      @map("mime_type") @db.VarChar(120)
  expiryDate   DateTime?    @map("expiry_date") @db.Date
  isVerified   Boolean      @default(false) @map("is_verified")
  uploadedBy   BigInt?      @map("uploaded_by")
  uploadedDate DateTime     @default(now()) @map("uploaded_date")

  user    User     @relation(fields: [userId], references: [userId], onDelete: Cascade)
  company Company? @relation(fields: [companyId], references: [companyId], onDelete: Cascade)

  @@map("user_attachments")
}`,

  UserDelegation: `model UserDelegation {
  delegationId   BigInt           @id @default(autoincrement()) @map("delegation_id")
  userId         BigInt           @map("user_id")
  delegateUserId BigInt           @map("delegate_user_id")
  companyId      BigInt           @map("company_id")
  startDate      DateTime         @map("start_date") @db.Date
  endDate        DateTime?        @map("end_date") @db.Date
  reason         String?          @db.VarChar(255)
  status         DelegationStatus @default(active)
  createdBy      BigInt?          @map("created_by")
  createdAt      DateTime         @default(now()) @map("created_at")

  user     User    @relation("Delegator", fields: [userId], references: [userId], onDelete: Cascade)
  delegate User    @relation("Delegatee", fields: [delegateUserId], references: [userId], onDelete: Cascade)
  company  Company @relation(fields: [companyId], references: [companyId], onDelete: Cascade)

  @@map("user_delegations")
}`,

  UserConsent: `model UserConsent {
  consentId      BigInt      @id @default(autoincrement()) @map("consent_id")
  userId         BigInt      @map("user_id")
  companyId      BigInt?     @map("company_id")
  consentType    ConsentType @map("consent_type")
  consentVersion String      @map("consent_version") @db.VarChar(20)
  isAccepted     Boolean     @default(false) @map("is_accepted")
  acceptedDate   DateTime?   @map("accepted_date")
  ipAddress      String?     @map("ip_address")
  createdAt      DateTime    @default(now()) @map("created_at")

  user    User     @relation(fields: [userId], references: [userId], onDelete: Cascade)
  company Company? @relation(fields: [companyId], references: [companyId], onDelete: Cascade)

  @@map("user_consents")
}`,

  UserAudit: `model UserAudit {
  auditId     BigInt          @id @default(autoincrement()) @map("audit_id")
  userId      BigInt?         @map("user_id")
  companyId   BigInt?         @map("company_id")
  action      UserAuditAction
  entityName  String          @map("entity_name") @db.VarChar(80)
  entityId    BigInt?         @map("entity_id")
  oldValue    Json?           @map("old_value")
  newValue    Json?           @map("new_value")
  ipAddress   String?         @map("ip_address")
  performedBy BigInt?         @map("performed_by")
  performedAt DateTime        @default(now()) @map("performed_at")

  user    User?    @relation(fields: [userId], references: [userId], onDelete: SetNull)
  company Company? @relation(fields: [companyId], references: [companyId])

  @@index([userId])
  @@index([entityName, entityId])
  @@map("user_audit")
}`,
};

let created = 0;
for (const t of TABLES) {
  const dir = path.join(PRISMA_IAM, `${t.n}-${t.folder}`);
  fs.mkdirSync(dir, { recursive: true });

  const schemaPath = path.join(dir, 'schema.prisma');
  const body = MODELS[t.model];
  if (!body) throw new Error(`Missing model: ${t.model}`);
  fs.writeFileSync(
    schemaPath,
    `// IAM | ${t.map} | Prisma model\n\n${body}\n`,
    'utf8',
  );

  const valDest = path.join(dir, 'validation.sql');
  if (!fs.existsSync(valDest)) {
    fs.writeFileSync(valDest, `-- Validation | ${t.map}\nSELECT 1;\n`, 'utf8');
  }

  created++;
  console.log(`  ${t.n}-${t.folder}/schema.prisma + validation.sql`);
}

console.log(`\nDone. ${created} table folders in prisma/iam/`);
