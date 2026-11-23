-- Migración paso 5a: tablas de autenticación, sesiones y auditoría

-- -------------------------------------------------------------------------
-- 1. Renombrar organization_memberships → user_organizations
--    y renombrar la columna organization_id → org_id
-- -------------------------------------------------------------------------
ALTER TABLE "organization_memberships" RENAME TO "user_organizations";--> statement-breakpoint
ALTER TABLE "user_organizations" RENAME COLUMN "organization_id" TO "org_id";--> statement-breakpoint
ALTER TABLE "user_organizations" RENAME CONSTRAINT "organization_memberships_user_id_users_id_fk" TO "user_organizations_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_organizations" RENAME CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" TO "user_organizations_org_id_organizations_id_fk";--> statement-breakpoint
ALTER TABLE "user_organizations" RENAME CONSTRAINT "organization_memberships_user_id_organization_id_pk" TO "user_organizations_user_id_org_id_pk";--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 2. Modificar tabla users
--    - Eliminar columnas antiguas: totp_secret, is_platform_admin
--    - Añadir columnas nuevas del paso 5a
-- -------------------------------------------------------------------------
ALTER TABLE "users" DROP COLUMN IF EXISTS "totp_secret";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "is_platform_admin";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_fa_method" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_last_step" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "recovery_codes" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_code_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_code_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 3. Añadir last_seen_at a devices
-- -------------------------------------------------------------------------
ALTER TABLE "devices" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 4. Crear tabla sessions
-- -------------------------------------------------------------------------
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"mfa_verified_at" timestamp with time zone,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text
);--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 5. Crear tabla trusted_devices
-- -------------------------------------------------------------------------
CREATE TABLE "trusted_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text
);--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 6. Crear tabla audit_log
-- -------------------------------------------------------------------------
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"org_id" uuid,
	"event" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint

-- -------------------------------------------------------------------------
-- 7. Claves foráneas en las tablas nuevas
-- -------------------------------------------------------------------------
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL ON UPDATE no action;
