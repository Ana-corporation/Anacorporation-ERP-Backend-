-- Phase 2: OAuth identity linking for Google / Microsoft login

CREATE TYPE "OAuthProvider" AS ENUM ('google', 'microsoft');

CREATE TABLE "user_oauth_identities" (
    "oauth_identity_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "provider_user_id" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "display_name" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "user_oauth_identities_pkey" PRIMARY KEY ("oauth_identity_id")
);

CREATE UNIQUE INDEX "user_oauth_identities_provider_provider_user_id_key"
  ON "user_oauth_identities"("provider", "provider_user_id");

CREATE INDEX "user_oauth_identities_user_id_idx" ON "user_oauth_identities"("user_id");

ALTER TABLE "user_oauth_identities"
  ADD CONSTRAINT "user_oauth_identities_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
