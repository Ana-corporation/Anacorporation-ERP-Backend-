-- Session idle timeout: raise default 60 → 480 minutes (8 hours)
-- Matches JWT_ACCESS_EXPIRATION=8h for ERP desk sessions.

ALTER TABLE "company_security_policies"
  ALTER COLUMN "session_timeout_min" SET DEFAULT 480;

-- Bump rows still on the old default only (preserve intentional custom values)
UPDATE "company_security_policies"
SET "session_timeout_min" = 480,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "session_timeout_min" = 60;
