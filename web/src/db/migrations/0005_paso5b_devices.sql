-- Migración paso 5b (parte 1): nuevos campos en la tabla devices

ALTER TABLE "devices" ADD COLUMN "device_type" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "critical_services" jsonb;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "credential_revoked_at" timestamp with time zone;
