-- Company Admin login codes + primary admin flag

ALTER TABLE "user_companies"
  ADD COLUMN IF NOT EXISTS "is_primary_admin" BOOLEAN NOT NULL DEFAULT false;

-- Assign ADMIN001, ADMIN002, ... to ADMIN memberships that have no employee_id
DO $$
DECLARE
  rec RECORD;
  n INT;
  candidate TEXT;
BEGIN
  FOR rec IN
    SELECT uc.user_company_id, uc.company_id
    FROM user_companies uc
    INNER JOIN user_roles ur
      ON ur.user_id = uc.user_id
     AND ur.company_id = uc.company_id
     AND ur.is_active = true
    INNER JOIN roles r
      ON r.role_id = ur.role_id
     AND r.role_code = 'ADMIN'
     AND r.deleted_at IS NULL
    WHERE uc.deleted_at IS NULL
      AND (uc.employee_id IS NULL OR btrim(uc.employee_id) = '')
    ORDER BY uc.company_id, uc.user_company_id
  LOOP
    n := 1;
    LOOP
      candidate := 'ADMIN' || lpad(n::text, 3, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM user_companies
        WHERE company_id = rec.company_id
          AND deleted_at IS NULL
          AND employee_id = candidate
      );
      n := n + 1;
      EXIT WHEN n > 9999;
    END LOOP;

    IF n <= 9999 THEN
      UPDATE user_companies
      SET employee_id = candidate,
          updated_at = NOW()
      WHERE user_company_id = rec.user_company_id;
    END IF;
  END LOOP;
END $$;

-- One primary admin per company when none is marked yet (earliest ADMIN membership)
UPDATE user_companies uc
SET is_primary_admin = true,
    updated_at = NOW()
WHERE uc.user_company_id IN (
  SELECT DISTINCT ON (inner_uc.company_id) inner_uc.user_company_id
  FROM user_companies inner_uc
  INNER JOIN user_roles ur
    ON ur.user_id = inner_uc.user_id
   AND ur.company_id = inner_uc.company_id
   AND ur.is_active = true
  INNER JOIN roles r
    ON r.role_id = ur.role_id
   AND r.role_code = 'ADMIN'
   AND r.deleted_at IS NULL
  WHERE inner_uc.deleted_at IS NULL
    AND inner_uc.status IN ('active', 'invited')
    AND NOT EXISTS (
      SELECT 1
      FROM user_companies existing
      WHERE existing.company_id = inner_uc.company_id
        AND existing.deleted_at IS NULL
        AND existing.is_primary_admin = true
    )
  ORDER BY inner_uc.company_id, inner_uc.user_company_id
);

-- Reassign duplicate employee_id within the same company (keep lowest user_company_id)
DO $$
DECLARE
  rec RECORD;
  n INT;
  candidate TEXT;
BEGIN
  FOR rec IN
    SELECT uc.user_company_id, uc.company_id, uc.employee_id
    FROM user_companies uc
    INNER JOIN (
      SELECT company_id, employee_id
      FROM user_companies
      WHERE deleted_at IS NULL
        AND employee_id IS NOT NULL
        AND btrim(employee_id) <> ''
      GROUP BY company_id, employee_id
      HAVING COUNT(*) > 1
    ) d ON d.company_id = uc.company_id AND d.employee_id = uc.employee_id
    WHERE uc.deleted_at IS NULL
      AND uc.user_company_id <> (
        SELECT MIN(u2.user_company_id)
        FROM user_companies u2
        WHERE u2.company_id = uc.company_id
          AND u2.employee_id = uc.employee_id
          AND u2.deleted_at IS NULL
      )
  LOOP
    n := 1;
    LOOP
      candidate := 'USER' || lpad(n::text, 3, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM user_companies
        WHERE company_id = rec.company_id
          AND deleted_at IS NULL
          AND employee_id = candidate
      );
      n := n + 1;
      EXIT WHEN n > 99999;
    END LOOP;

    UPDATE user_companies
    SET employee_id = candidate,
        updated_at = NOW()
    WHERE user_company_id = rec.user_company_id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS user_companies_company_employee_id_uidx
  ON user_companies (company_id, employee_id)
  WHERE deleted_at IS NULL AND employee_id IS NOT NULL;
