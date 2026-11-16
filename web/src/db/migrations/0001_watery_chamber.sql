DROP INDEX "inventory_snapshots_device_hash_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "daily_reports_device_collected_at_idx" ON "daily_reports" USING btree ("device_id","collected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_snapshots_device_hash_idx" ON "inventory_snapshots" USING btree ("device_id","hash");