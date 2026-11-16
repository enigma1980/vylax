DROP INDEX "inventory_snapshots_device_hash_idx";--> statement-breakpoint
CREATE INDEX "inventory_snapshots_device_hash_idx" ON "inventory_snapshots" USING btree ("device_id","hash");