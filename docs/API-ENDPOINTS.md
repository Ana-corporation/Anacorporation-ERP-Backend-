# ERP Backend — API Endpoints & Code Tracker

Use this file to track **routes → controller → service → repository → DTO → Prisma model**.

**Base URL:** `http://localhost:3000/api/v1`  
**Route prefix set in:** `src/main.ts` (`api/v1`)  
**Modules wired in:** `src/app.module.ts`  
**Swagger UI:** `http://localhost:3000/docs`  
**Validation:** Zod (`nestjs-zod`) — DTOs in each `dto/` folder

---

## App wiring

| What | File |
|------|------|
| Start app + API prefix | `src/main.ts` |
| Register all modules | `src/app.module.ts` |
| Global auth guard | `src/common/guards/jwt-auth.guard.ts` |
| Tenant guard (`companyId`) | `src/common/guards/tenant.guard.ts` |
| Permissions guard | `src/common/guards/permissions.guard.ts` |
| Pagination DTO (shared) | `src/common/dto/pagination.dto.ts` |
| Zod shared schemas | `src/common/zod/common.schemas.ts` |
| Prisma client | `src/infrastructure/prisma/prisma.service.ts` |
| Audit logs | `src/infrastructure/audit/audit.service.ts` |

---

## Module tree (active Phase 1)

```
src/modules/
├── health/
│   └── health.module.ts              ← HealthController (inline)
├── shared/
│   ├── shared.module.ts
│   └── currencies/
│       ├── currencies.module.ts
│       ├── currencies.controller.ts  ← routes
│       ├── currencies.service.ts
│       ├── currencies.repository.ts
│       └── dto/currency.dto.ts
├── organization/
│   ├── organization.module.ts
│   └── companies/
│       ├── companies.module.ts
│       ├── companies.controller.ts
│       ├── companies.service.ts
│       ├── companies.repository.ts
│       └── dto/company.dto.ts
│   └── departments/
│       ├── departments.module.ts
│       ├── departments.controller.ts
│       ├── departments.service.ts
│       ├── departments.repository.ts
│       └── dto/department.dto.ts
│   └── designations/
│       ├── designations.module.ts
│       ├── designations.controller.ts
│       ├── designations.service.ts
│       ├── designations.repository.ts
│       └── dto/designation.dto.ts
└── subscription/
    ├── subscription.module.ts
    ├── plans/
    │   ├── plans.module.ts
    │   ├── plans.controller.ts
    │   ├── plan-modules.controller.ts
    │   ├── plans.service.ts
    │   ├── plan-modules.service.ts
    │   ├── plans.repository.ts
    │   ├── plan-modules.repository.ts
    │   └── dto/
    └── erp-modules/
        ├── erp-modules.module.ts
        ├── erp-modules.controller.ts
        ├── erp-modules.service.ts
        ├── erp-modules.repository.ts
        └── dto/erp-module.dto.ts
└── iam/
    ├── iam.module.ts
    ├── authentication/
    │   ├── auth.module.ts
    │   ├── auth.controller.ts
    │   ├── auth.service.ts
    │   ├── auth.repository.ts
    │   ├── dto/auth.dto.ts
    │   └── strategies/jwt.strategy.ts
    ├── users/
    │   ├── users.module.ts
    │   ├── users.controller.ts
    │   ├── users.service.ts
    │   ├── users.repository.ts
    │   └── dto/user.dto.ts
    ├── roles/
    │   ├── roles.module.ts
    │   ├── roles.controller.ts
    │   ├── roles.service.ts
    │   ├── roles.repository.ts
    │   └── dto/role.dto.ts
    └── permissions/
        ├── permissions.module.ts
        ├── permissions.controller.ts
        ├── permissions.service.ts
        └── (no repository — uses Prisma in service)
    └── super-admins/
        ├── super-admins.module.ts
        ├── super-admins.controller.ts
        ├── super-admins.service.ts
        ├── super-admins.repository.ts
        └── dto/super-admin.dto.ts
```

---

## Prisma models (database tables)

| Feature | Prisma file | Model / table |
|---------|-------------|---------------|
| Currencies | `prisma/shared/currencies.prisma` | `Currency` → `currencies` |
| Companies | `prisma/organization/companies.prisma` | `Company` → `companies` |
| Departments | `prisma/organization/departments.prisma` | `Department` → `departments` |
| Designations | `prisma/organization/designations.prisma` | `Designation` → `designations` |
| Subscription plans | `prisma/subscription/subscription-plans.prisma` | `SubscriptionPlan` → `subscription_plans` |
| ERP modules | `prisma/subscription/modules.prisma` | `Module` → `modules` |
| Plan modules | `prisma/subscription/plan-modules.prisma` | `PlanModule` → `plan_modules` |
| Users | `prisma/iam/users.prisma` | `User` → `users` |
| User auth | `prisma/iam/user-authentication.prisma` | `UserAuthentication` → `user_authentication` |
| User companies | `prisma/iam/user-companies.prisma` | `UserCompany` → `user_companies` |
| User roles | `prisma/iam/user-roles.prisma` | `UserRole` → `user_roles` |
| User sessions | `prisma/iam/user-sessions.prisma` | `UserSession` → `user_sessions` |
| Roles | `prisma/iam/roles.prisma` | `Role` → `roles` |
| Role permissions | `prisma/iam/role-permissions.prisma` | `RolePermission` → `role_permissions` |
| Permissions | `prisma/iam/permissions.prisma` | `Permission` → `permissions` |
| Modules | `prisma/subscription/modules.prisma` | `Module` → `modules` |
| User audit | `prisma/audit/user-audit.prisma` | `UserAudit` → `user_audit` |
| Super admins | `prisma/iam/super-admins.prisma` | `SuperAdmin` → `super_admins` |

---

# 1. Health

| Item | Path |
|------|------|
| Module | `src/modules/health/health.module.ts` |
| Controller | `HealthController` (inside `health.module.ts`) |
| Route prefix | `@Controller('health')` |
| Prisma | `src/infrastructure/prisma/prisma.service.ts` |

| Method | Full route | Controller method | Service |
|--------|------------|-------------------|---------|
| GET | `/api/v1/health` | `check()` | inline (Prisma + Redis) |

---

# 2. Auth

| Item | Path |
|------|------|
| Module | `src/modules/iam/authentication/auth.module.ts` |
| Controller | `src/modules/iam/authentication/auth.controller.ts` |
| Service | `src/modules/iam/authentication/auth.service.ts` |
| Repository | `src/modules/iam/authentication/auth.repository.ts` |
| DTO / Zod | `src/modules/iam/authentication/dto/auth.dto.ts` |
| JWT strategy | `src/modules/iam/authentication/strategies/jwt.strategy.ts` |
| Route prefix | `@Controller('auth')` |

| Method | Full route | Controller → Service | DTO |
|--------|------------|----------------------|-----|
| POST | `/api/v1/auth/signup` | `signUp()` → `authService.signUp()` | `SignUpDto` |
| POST | `/api/v1/auth/login` | `login()` → `authService.login()` | `LoginDto` |
| POST | `/api/v1/auth/refresh` | `refresh()` → `authService.refresh()` | `RefreshTokenDto` |
| GET | `/api/v1/auth/me` | `getMe()` → `authService.getMe()` | — |
| GET | `/api/v1/auth/companies` | `getMyCompanies()` → `authService.getMyCompanies()` | — |
| POST | `/api/v1/auth/logout` | `logout()` → `authService.logout()` | `RefreshTokenDto` |
| POST | `/api/v1/auth/switch-company` | `switchCompany()` → `authService.switchCompany()` | `SwitchCompanyDto` |

**Signup body example**
```json
{
  "email": "john@company.com",
  "password": "SecurePass1",
  "confirmPassword": "SecurePass1",
  "firstName": "John",
  "lastName": "Doe",
  "companyName": "Acme Manufacturing"
}
```

---

# 2a. Super Admins (platform owners)

| Item | Path |
|------|------|
| Module | `src/modules/iam/super-admins/super-admins.module.ts` |
| Controller | `src/modules/iam/super-admins/super-admins.controller.ts` |
| Prisma model | `prisma/iam/super-admins.prisma` → `super_admins` |
| Route prefix | `@Controller('super-admins')` |

| Method | Full route | Auth | Permission | DTO |
|--------|------------|------|------------|-----|
| POST | `/api/v1/super-admins/bootstrap` | Public (first admin only) | — | `CreateSuperAdminDto` |
| POST | `/api/v1/super-admins/auth/login` | Public | — | `SuperAdminLoginDto` |
| GET | `/api/v1/super-admins` | Super admin JWT | `super_admins:view` | `PaginationQueryDto` |
| GET | `/api/v1/super-admins/:id` | Super admin JWT | `super_admins:view` | — |
| POST | `/api/v1/super-admins` | Super admin JWT | `super_admins:create` | `CreateSuperAdminDto` |
| PATCH | `/api/v1/super-admins/:id` | Super admin JWT | `super_admins:edit` | `UpdateSuperAdminDto` |
| DELETE | `/api/v1/super-admins/:id` | Super admin JWT | `super_admins:delete` | — |

**Bootstrap body (run once when table is empty)**
```json
{ "name": "Platform Owner", "email": "superadmin@erp.com", "password": "SecurePass1" }
```

---
  
---

# 3. Currencies

| Item | Path |
|------|------|
| Parent module | `src/modules/shared/shared.module.ts` |
| Module | `src/modules/shared/currencies/currencies.module.ts` |
| Controller | `src/modules/shared/currencies/currencies.controller.ts` |
| Service | `src/modules/shared/currencies/currencies.service.ts` |
| Repository | `src/modules/shared/currencies/currencies.repository.ts` |
| DTO / Zod | `src/modules/shared/currencies/dto/currency.dto.ts` |
| Prisma model | `prisma/shared/currencies.prisma` |
| Route prefix | `@Controller('currencies')` |

| Method | Full route | Controller → Service → Repository | Permission | DTO |
|--------|------------|-----------------------------------|------------|-----|
| GET | `/api/v1/currencies` | `findAll()` → `findAll()` → `findMany()` | `currencies:view` | `PaginationQueryDto` |
| GET | `/api/v1/currencies/:id` | `findOne()` → `findOne()` → `findById()` | `currencies:view` | — |
| POST | `/api/v1/currencies` | `create()` → `create()` → `create()` | `currencies:manage` | `CreateCurrencyDto` |
| PATCH | `/api/v1/currencies/:id` | `update()` → `update()` → `update()` | `currencies:manage` | `UpdateCurrencyDto` |
| DELETE | `/api/v1/currencies/:id` | `remove()` → `remove()` → `softDelete()` | `currencies:manage` | — |

**Create body example**
```json
{ "code": "USD", "name": "US Dollar", "symbol": "$", "decimalPlaces": 2, "isActive": true }
```

---

# 4. Companies

| Item | Path |
|------|------|
| Parent module | `src/modules/organization/organization.module.ts` |
| Module | `src/modules/organization/companies/companies.module.ts` |
| Controller | `src/modules/organization/companies/companies.controller.ts` |
| Service | `src/modules/organization/companies/companies.service.ts` |
| Repository | `src/modules/organization/companies/companies.repository.ts` |
| DTO / Zod | `src/modules/organization/companies/dto/company.dto.ts` |
| Prisma model | `prisma/organization/companies.prisma` |
| Route prefix | `@Controller('companies')` |

| Method | Full route | Controller → Service → Repository | Permission | DTO |
|--------|------------|-----------------------------------|------------|-----|
| GET | `/api/v1/companies` | `findAll()` → `findAll()` → `findMany()` | `companies:view` | `PaginationQueryDto` |
| GET | `/api/v1/companies/:id` | `findOne()` → `findOne()` → `findById()` | `companies:view` | — |
| POST | `/api/v1/companies` | `create()` → `create()` → `create()` | `companies:create` | `CreateCompanyDto` |
| PATCH | `/api/v1/companies/:id` | `update()` → `update()` → `update()` | `companies:edit` | `UpdateCompanyDto` |
| DELETE | `/api/v1/companies/:id` | `remove()` → `remove()` → `softDelete()` | `companies:delete` | — |

---

# 4a. Departments

| Item | Path |
|------|------|
| Parent module | `src/modules/organization/organization.module.ts` |
| Module | `src/modules/organization/departments/departments.module.ts` |
| Controller | `src/modules/organization/departments/departments.controller.ts` |
| Service | `src/modules/organization/departments/departments.service.ts` |
| Repository | `src/modules/organization/departments/departments.repository.ts` |
| DTO / Zod | `src/modules/organization/departments/dto/department.dto.ts` |
| Prisma model | `prisma/organization/departments.prisma` |
| Route prefix | `@Controller('companies/:companyId/departments')` |

| Method | Full route | Controller → Service → Repository | Permission | DTO |
|--------|------------|-----------------------------------|------------|-----|
| GET | `/api/v1/companies/:companyId/departments` | `findAll()` → `findAll()` → `findManyByCompany()` | `departments:view` | `PaginationQueryDto` |
| GET | `/api/v1/companies/:companyId/departments/:id` | `findOne()` → `findOne()` → `findById()` | `departments:view` | — |
| POST | `/api/v1/companies/:companyId/departments` | `create()` → `create()` → `create()` | `departments:create` | `CreateDepartmentDto` |
| PATCH | `/api/v1/companies/:companyId/departments/:id` | `update()` → `update()` → `update()` | `departments:edit` | `UpdateDepartmentDto` |
| DELETE | `/api/v1/companies/:companyId/departments/:id` | `remove()` → `remove()` → `softDelete()` | `departments:delete` | — |

**Create body example**
```json
{ "departmentCode": "HR", "name": "Human Resources", "parentDepartmentId": "1", "isActive": true }
```

---

# 4b. Designations

| Item | Path |
|------|------|
| Parent module | `src/modules/organization/organization.module.ts` |
| Module | `src/modules/organization/designations/designations.module.ts` |
| Controller | `src/modules/organization/designations/designations.controller.ts` |
| Service | `src/modules/organization/designations/designations.service.ts` |
| Repository | `src/modules/organization/designations/designations.repository.ts` |
| DTO / Zod | `src/modules/organization/designations/dto/designation.dto.ts` |
| Prisma model | `prisma/organization/designations.prisma` |
| Route prefix | `@Controller('companies/:companyId/designations')` |

| Method | Full route | Controller → Service → Repository | Permission | DTO |
|--------|------------|-----------------------------------|------------|-----|
| GET | `/api/v1/companies/:companyId/designations` | `findAll()` → `findAll()` → `findManyByCompany()` | `designations:view` | `PaginationQueryDto` |
| GET | `/api/v1/companies/:companyId/designations/:id` | `findOne()` → `findOne()` → `findById()` | `designations:view` | — |
| POST | `/api/v1/companies/:companyId/designations` | `create()` → `create()` → `create()` | `designations:create` | `CreateDesignationDto` |
| PATCH | `/api/v1/companies/:companyId/designations/:id` | `update()` → `update()` → `update()` | `designations:edit` | `UpdateDesignationDto` |
| DELETE | `/api/v1/companies/:companyId/designations/:id` | `remove()` → `remove()` → `softDelete()` | `designations:delete` | — |

**Create body example**
```json
{ "designationCode": "MGR", "name": "Manager", "gradeLevel": 5, "isActive": true }
```

---

# 4c. Subscription Plans

| Item | Path |
|------|------|
| Module | `src/modules/subscription/plans/plans.module.ts` |
| Controller | `src/modules/subscription/plans/plans.controller.ts` |
| Route prefix | `@Controller('subscription/plans')` |

| Method | Full route | Permission | DTO |
|--------|------------|------------|-----|
| GET | `/api/v1/subscription/plans` | `subscription_plans:view` | `PaginationQueryDto` |
| GET | `/api/v1/subscription/plans/:id` | `subscription_plans:view` | — |
| POST | `/api/v1/subscription/plans` | `subscription_plans:create` | `CreateSubscriptionPlanDto` |
| PATCH | `/api/v1/subscription/plans/:id` | `subscription_plans:edit` | `UpdateSubscriptionPlanDto` |
| DELETE | `/api/v1/subscription/plans/:id` | `subscription_plans:delete` | — |

---

# 4d. ERP Modules (catalogue)

| Item | Path |
|------|------|
| Controller | `src/modules/subscription/erp-modules/erp-modules.controller.ts` |
| Route prefix | `@Controller('subscription/modules')` |

| Method | Full route | Permission | DTO |
|--------|------------|------------|-----|
| GET | `/api/v1/subscription/modules` | `subscription_modules:view` | `PaginationQueryDto` |
| GET | `/api/v1/subscription/modules/:id` | `subscription_modules:view` | — |
| POST | `/api/v1/subscription/modules` | `subscription_modules:create` | `CreateErpModuleDto` |
| PATCH | `/api/v1/subscription/modules/:id` | `subscription_modules:edit` | `UpdateErpModuleDto` |
| DELETE | `/api/v1/subscription/modules/:id` | `subscription_modules:delete` | — |

---

# 4e. Plan Modules (plan ↔ module bridge)

| Item | Path |
|------|------|
| Controller | `src/modules/subscription/plans/plan-modules.controller.ts` |
| Prisma model | `prisma/subscription/plan-modules.prisma` → `plan_modules` |
| Route prefix | `@Controller('subscription/plans/:planId/modules')` |

| Method | Full route | Permission | DTO |
|--------|------------|------------|-----|
| GET | `/api/v1/subscription/plans/:planId/modules` | `plan_modules:view` | — |
| GET | `/api/v1/subscription/plans/:planId/modules/:id` | `plan_modules:view` | — |
| POST | `/api/v1/subscription/plans/:planId/modules` | `plan_modules:manage` | `AddPlanModuleDto` |
| DELETE | `/api/v1/subscription/plans/:planId/modules/:id` | `plan_modules:manage` | — |

**Create body example**
```json
{ "moduleId": "5" }
```

---

# 4f. User API Keys

| Item | Path |
|------|------|
| Module | `src/modules/iam/api-keys/api-keys.module.ts` |
| Controller | `src/modules/iam/api-keys/api-keys.controller.ts` |
| Prisma model | `prisma/iam/user-api-keys.prisma` → `user_api_keys` |
| Route prefix | `@Controller('users/:userId/api-keys')` |

| Method | Full route | Permission | DTO |
|--------|------------|------------|-----|
| GET | `/api/v1/users/:userId/api-keys` | `api_keys:view` | `PaginationQueryDto` |
| GET | `/api/v1/users/:userId/api-keys/:id` | `api_keys:view` | — |
| POST | `/api/v1/users/:userId/api-keys` | `api_keys:create` | `CreateApiKeyDto` |
| PATCH | `/api/v1/users/:userId/api-keys/:id` | `api_keys:edit` | `UpdateApiKeyDto` |
| DELETE | `/api/v1/users/:userId/api-keys/:id` | `api_keys:delete` | — |

**Create body example**
```json
{ "name": "Integration Bot", "scope": "inventory:read", "expiryDate": "2027-12-31" }
```

---

# 4g. User Attachments

| Item | Path |
|------|------|
| Module | `src/modules/iam/user-attachments/user-attachments.module.ts` |
| Controller | `src/modules/iam/user-attachments/user-attachments.controller.ts` |
| Prisma model | `prisma/iam/user-attachments.prisma` → `user_attachments` |
| Route prefix | `@Controller('users/:userId/attachments')` |

| Method | Full route | Permission | DTO |
|--------|------------|------------|-----|
| GET | `/api/v1/users/:userId/attachments` | `user_attachments:view` | `PaginationQueryDto` |
| GET | `/api/v1/users/:userId/attachments/:id` | `user_attachments:view` | — |
| POST | `/api/v1/users/:userId/attachments` | `user_attachments:create` | `CreateUserAttachmentDto` |
| PATCH | `/api/v1/users/:userId/attachments/:id` | `user_attachments:edit` | `UpdateUserAttachmentDto` |
| DELETE | `/api/v1/users/:userId/attachments/:id` | `user_attachments:delete` | — |

**Create body example**
```json
{
  "documentType": "passport",
  "fileName": "passport-scan.pdf",
  "filePath": "companies/11/users/11/passport-scan.pdf",
  "fileSize": 245760,
  "mimeType": "application/pdf",
  "expiryDate": "2030-06-01"
}
```

---

# 4h. User Consents

| Item | Path |
|------|------|
| Module | `src/modules/iam/user-consents/user-consents.module.ts` |
| Controller | `src/modules/iam/user-consents/user-consents.controller.ts` |
| Prisma model | `prisma/iam/user-consents.prisma` → `user_consents` |
| Route prefix | `@Controller('users/:userId/consents')` |

| Method | Full route | Permission | DTO |
|--------|------------|------------|-----|
| GET | `/api/v1/users/:userId/consents` | `user_consents:view` | `PaginationQueryDto` |
| GET | `/api/v1/users/:userId/consents/:id` | `user_consents:view` | — |
| POST | `/api/v1/users/:userId/consents` | `user_consents:create` | `CreateUserConsentDto` |
| PATCH | `/api/v1/users/:userId/consents/:id` | `user_consents:edit` | `UpdateUserConsentDto` |
| DELETE | `/api/v1/users/:userId/consents/:id` | `user_consents:delete` | — |

**Create body example**
```json
{
  "consentType": "privacy_policy",
  "consentVersion": "v2.1",
  "isAccepted": true,
  "ipAddress": "192.168.1.10"
}
```

---

# 4i. User Delegations

| Item | Path |
|------|------|
| Module | `src/modules/iam/user-delegations/user-delegations.module.ts` |
| Controller | `src/modules/iam/user-delegations/user-delegations.controller.ts` |
| Prisma model | `prisma/iam/user-delegations.prisma` → `user_delegations` |
| Route prefix | `@Controller('users/:userId/delegations')` |

| Method | Full route | Permission | DTO |
|--------|------------|------------|-----|
| GET | `/api/v1/users/:userId/delegations` | `user_delegations:view` | `PaginationQueryDto` |
| GET | `/api/v1/users/:userId/delegations/:id` | `user_delegations:view` | — |
| POST | `/api/v1/users/:userId/delegations` | `user_delegations:create` | `CreateUserDelegationDto` |
| PATCH | `/api/v1/users/:userId/delegations/:id` | `user_delegations:edit` | `UpdateUserDelegationDto` |
| DELETE | `/api/v1/users/:userId/delegations/:id` | `user_delegations:delete` | — |

**Create body example**
```json
{
  "delegateUserId": "11",
  "startDate": "2026-07-01",
  "endDate": "2026-07-31",
  "reason": "Annual leave coverage"
}
```

---

# 4j. User Devices

| Item | Path |
|------|------|
| Module | `src/modules/iam/user-devices/user-devices.module.ts` |
| Controller | `src/modules/iam/user-devices/user-devices.controller.ts` |
| Prisma model | `prisma/iam/user-devices.prisma` → `user_devices` |
| Route prefix | `@Controller('users/:userId/devices')` |

| Method | Full route | Permission | DTO |
|--------|------------|------------|-----|
| GET | `/api/v1/users/:userId/devices` | `user_devices:view` | `PaginationQueryDto` |
| GET | `/api/v1/users/:userId/devices/:id` | `user_devices:view` | — |
| POST | `/api/v1/users/:userId/devices` | `user_devices:create` | `CreateUserDeviceDto` |
| PATCH | `/api/v1/users/:userId/devices/:id` | `user_devices:edit` | `UpdateUserDeviceDto` |
| DELETE | `/api/v1/users/:userId/devices/:id` | `user_devices:delete` | — |

**Create body example**
```json
{
  "deviceUuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "deviceName": "Work Laptop",
  "manufacturer": "Dell",
  "model": "Latitude 5540",
  "os": "Windows 11",
  "browser": "Chrome",
  "isTrusted": true
}
```

---

# 5. Users

| Item | Path |
|------|------|
| Parent module | `src/modules/iam/iam.module.ts` |
| Module | `src/modules/iam/users/users.module.ts` |
| Controller | `src/modules/iam/users/users.controller.ts` |
| Service | `src/modules/iam/users/users.service.ts` |
| Repository | `src/modules/iam/users/users.repository.ts` |
| DTO / Zod | `src/modules/iam/users/dto/user.dto.ts` |
| Prisma models | `prisma/iam/users.prisma`, `user-authentication.prisma`, `user-companies.prisma`, `user-roles.prisma` |
| Route prefix | `@Controller('users')` |

| Method | Full route | Controller → Service → Repository | Permission | DTO |
|--------|------------|-----------------------------------|------------|-----|
| GET | `/api/v1/users` | `findAll()` → `findAll()` → `findManyByCompany()` | `users:view` | `PaginationQueryDto` |
| GET | `/api/v1/users/:id` | `findOne()` → `findOne()` → `findById()` | `users:view` | — |
| POST | `/api/v1/users` | `create()` → `create()` → `create()` | `users:create` | `CreateUserDto` |
| PATCH | `/api/v1/users/:id` | `update()` → `update()` → `update()` | `users:edit` | `UpdateUserDto` |
| DELETE | `/api/v1/users/:id` | `remove()` → `remove()` → `softDelete()` | `users:delete` | — |
| POST | `/api/v1/users/:id/roles` | `assignRole()` → `assignRole()` → `assignRole()` | `roles:edit` | `AssignUserRoleDto` |

---

# 6. Roles

| Item | Path |
|------|------|
| Module | `src/modules/iam/roles/roles.module.ts` |
| Controller | `src/modules/iam/roles/roles.controller.ts` |
| Service | `src/modules/iam/roles/roles.service.ts` |
| Repository | `src/modules/iam/roles/roles.repository.ts` |
| DTO / Zod | `src/modules/iam/roles/dto/role.dto.ts` |
| Prisma models | `prisma/iam/roles.prisma`, `role-permissions.prisma` |
| Route prefix | `@Controller('companies/:companyId/roles')` |

| Method | Full route | Controller → Service → Repository | Permission | DTO |
|--------|------------|-----------------------------------|------------|-----|
| GET | `/api/v1/companies/:companyId/roles` | `findAll()` → `findAll()` → `findManyByCompany()` | `roles:view` | `PaginationQueryDto` |
| GET | `/api/v1/companies/:companyId/roles/:id` | `findOne()` → `findOne()` → `findById()` | `roles:view` | — |
| POST | `/api/v1/companies/:companyId/roles` | `create()` → `create()` → `create()` | `roles:create` | `CreateRoleDto` |
| PATCH | `/api/v1/companies/:companyId/roles/:id` | `update()` → `update()` → `update()` | `roles:edit` | `UpdateRoleDto` |
| DELETE | `/api/v1/companies/:companyId/roles/:id` | `remove()` → `remove()` → `softDelete()` | `roles:delete` | — |
| PUT | `/api/v1/companies/:companyId/roles/:id/permissions` | `setPermissions()` → `setPermissions()` → `setPermissions()` | `roles:edit` | `SetRolePermissionsDto` |

---

# 7. Permissions

| Item | Path |
|------|------|
| Module | `src/modules/iam/permissions/permissions.module.ts` |
| Controller | `src/modules/iam/permissions/permissions.controller.ts` |
| Service | `src/modules/iam/permissions/permissions.service.ts` |
| Repository | — (Prisma calls in service) |
| Prisma model | `prisma/iam/permissions.prisma` |
| Route prefix | `@Controller('permissions')` |

| Method | Full route | Controller → Service | Permission |
|--------|------------|----------------------|------------|
| GET | `/api/v1/permissions` | `findAll()` → `findAll()` | `permissions:view` |
| GET | `/api/v1/permissions/:id` | `findOne()` → `findOne()` | `permissions:view` |

---

## Request flow (how to trace any API)

```
HTTP Request
    ↓
src/main.ts                    (prefix: /api/v1)
    ↓
src/app.module.ts              (guards: JWT, Tenant, Permissions)
    ↓
*.controller.ts                (route + @RequirePermissions)
    ↓
*.service.ts                   (business logic + audit)
    ↓
*.repository.ts                (Prisma queries)
    ↓
prisma/<domain>/*.prisma       (database table)
```

---

## List query params (all GET list routes — mandatory)

Every `GET` list endpoint accepts the same **query string** filters (defined in `src/common/dto/pagination.dto.ts`, applied in each repository via `src/common/utils/prisma-filter.util.ts`).

### Pagination & sort (all lists)

| Param | Default | Description |
|-------|---------|-------------|
| `page` | `1` | Page number |
| `limit` | `20` | Items per page (max 100) |
| `search` | — | Free text OR across configured text columns |
| `sortBy` | `createdAt` | Allowlisted per entity (invalid values fall back to default) |
| `sortOrder` | `desc` | `asc` or `desc` |

### Field filters (AND — send only what you need)

| Param | Match type | Used on (examples) |
|-------|------------|-------------------|
| `isActive` | exact boolean | branches, departments, users, modules… |
| `status` | exact | companies, subscriptions, delegations, sessions… |
| `code` | contains | branchCode, departmentCode, planCode… |
| `name` | contains | name fields |
| `email` | contains | users, super-admins |
| `city`, `country` | contains | branches |
| `fromDate`, `toDate` | date range | createdAt / startDate (per entity) |
| `documentType`, `consentType`, `signatureType`, `mfaType` | exact | user satellite tables |
| `sessionStatus`, `loginResult`, `accessType` | exact | sessions, login history, module access |
| `moduleId`, `planId` | exact ID | company modules, subscriptions |
| `isTrusted`, `isBlocked`, `isVerified`, `isAccepted` | exact boolean | devices, attachments, consents |
| `browser`, `os`, `manufacturer`, `deviceUuid` | contains | devices, sessions |
| `action`, `entityName` | contains / exact | audit logs |

**Logic:** path scope (companyId/userId) + soft-delete + **all sent filters AND** + optional `search` OR block.

Example:
```
GET /api/v1/companies/2/branches?city=Mumbai&isActive=true&search=main&page=1&limit=10&sortBy=name&sortOrder=asc
```

Example:
```
GET /api/v1/users/12/devices?isTrusted=true&os=Windows&search=laptop
```

---

## Permissions constant file

`src/common/constants/permissions.constant.ts`

---

## IAM schema coverage (`iam_rbac_schema.sql`)

| SQL table | API status | Route prefix |
|-----------|------------|--------------|
| `currencies` | Done | `/currencies` |
| `super_admins` | Done | `/super-admins` |
| `companies` | Done | `/companies` |
| `subscription_plans` | Done | `/subscription/plans` |
| `modules` | Done | `/subscription/modules` |
| `plan_modules` | Done | `/subscription/plans/:planId/modules` |
| `company_subscriptions` | Done | `/companies/:companyId/subscriptions` |
| `company_modules` | Done | `/companies/:companyId/modules` |
| `company_security_policies` | Done | `/companies/:companyId/security-policies` |
| `branches` | Done | `/companies/:companyId/branches` |
| `departments` | Done | `/companies/:companyId/departments` |
| `designations` | Done | `/companies/:companyId/designations` |
| `warehouses` | Done | `/companies/:companyId/warehouses` |
| `roles` | Done | `/companies/:companyId/roles` |
| `permissions` | Done (read) | `/permissions` |
| `role_permissions` | Done (via roles) | `PUT .../roles/:id/permissions` |
| `users` | Done | `/users` |
| `user_authentication` | Internal (auth) | `/auth/*` |
| `user_mfa` | Done | `/users/:userId/mfa` |
| `user_companies` | Partial (users/auth) | `/users`, `/auth` |
| `user_roles` | Partial (users) | `POST /users/:id/roles` |
| `user_module_access` | Done | `/users/:userId/module-access` |
| `user_preferences` | Done | `/users/:userId/preferences` |
| `user_devices` | Done | `/users/:userId/devices` |
| `user_sessions` | Done | `/users/:userId/sessions` |
| `user_login_history` | Done | `/users/:userId/login-history` |
| `user_password_history` | Internal (auth) | — |
| `user_api_keys` | Done | `/users/:userId/api-keys` |
| `user_notifications` | Done | `/users/:userId/notifications` |
| `user_signatures` | Done | `/users/:userId/signatures` |
| `user_attachments` | Done | `/users/:userId/attachments` |
| `user_delegations` | Done | `/users/:userId/delegations` |
| `user_consents` | Done | `/users/:userId/consents` |
| `user_audit` | Done (read-only) | `/users/:userId/audit-logs` |

---

## Status summary

| Module | Routes | Controller file | Status |
|--------|--------|-----------------|--------|
| Health | 1 | `health.module.ts` | Active |
| Auth | 7 | `auth.controller.ts` | Active |
| Super Admins | 7 | `super-admins.controller.ts` | Active |
| Currencies | 5 | `currencies.controller.ts` | Active |
| Companies | 5 | `companies.controller.ts` | Active |
| Departments | 5 | `departments.controller.ts` | Active |
| Designations | 5 | `designations.controller.ts` | Active |
| Branches | 5 | `branches.controller.ts` | Active |
| Warehouses | 5 | `warehouses.controller.ts` | Active |
| Company Security Policies | 5 | `company-security-policies.controller.ts` | Active |
| Subscription Plans | 5 | `plans.controller.ts` | Active |
| ERP Modules | 5 | `erp-modules.controller.ts` | Active |
| Plan Modules | 4 | `plan-modules.controller.ts` | Active |
| Company Subscriptions | 5 | `company-subscriptions.controller.ts` | Active |
| Company Modules | 5 | `company-modules.controller.ts` | Active |
| Users | 6 | `users.controller.ts` | Active |
| User API Keys | 5 | `api-keys.controller.ts` | Active |
| User Attachments | 5 | `user-attachments.controller.ts` | Active |
| User Consents | 5 | `user-consents.controller.ts` | Active |
| User Delegations | 5 | `user-delegations.controller.ts` | Active |
| User Devices | 5 | `user-devices.controller.ts` | Active |
| User MFA | 5 | `user-mfa.controller.ts` | Active |
| User Module Access | 5 | `user-module-access.controller.ts` | Active |
| User Preferences | 5 | `user-preferences.controller.ts` | Active |
| User Sessions | 5 | `user-sessions.controller.ts` | Active |
| User Login History | 3 | `user-login-history.controller.ts` | Active |
| User Notifications | 4 | `user-notifications.controller.ts` | Active |
| User Signatures | 5 | `user-signatures.controller.ts` | Active |
| User Audit Logs | 2 | `user-audit.controller.ts` | Active |
| Roles | 6 | `roles.controller.ts` | Active |
| Permissions | 2 | `permissions.controller.ts` | Active |
| **Total** | **143** | | |

### Not wired in `app.module.ts` yet (code exists, inactive)

| Module | Controller path | Status |
|--------|-----------------|--------|
| Customers | `src/modules/crm/customers/customers.controller.ts` | Inactive |
| Vendors | `src/modules/purchase/vendors/vendors.controller.ts` | Inactive |
| Products | `src/modules/inventory/items/products.controller.ts` | Inactive |
| Inventory | `src/modules/inventory/stock/inventory.controller.ts` | Inactive |

---

## Quick test

1. `POST /api/v1/auth/signup`
2. Copy `accessToken`
3. Header: `Authorization: Bearer <token>`
4. `GET /api/v1/auth/me`
5. `GET /api/v1/currencies`

Or use Swagger: `http://localhost:3000/docs`
