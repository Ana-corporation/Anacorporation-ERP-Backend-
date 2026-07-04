-- Shared validation helpers — run once before any *.validation.sql files
CREATE OR REPLACE FUNCTION fn_is_valid_email(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_email IS NULL
      OR p_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$';
$$;

CREATE OR REPLACE FUNCTION fn_is_valid_code(p_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_code IS NOT NULL
     AND length(trim(p_code)) > 0
     AND p_code ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$';
$$;

CREATE OR REPLACE FUNCTION fn_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF to_jsonb(NEW) ? 'updated_at' THEN
    NEW.updated_at := now();
  END IF;
  IF to_jsonb(NEW) ? 'row_version' THEN
    NEW.row_version := COALESCE(OLD.row_version, 0) + 1;
  END IF;
  RETURN NEW;
END;
$$;
