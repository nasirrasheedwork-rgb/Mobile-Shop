import { z } from "zod";
import { atomic, db, now, snapshot, tables } from "./db";
import { queueSchema, saleItems, schemas, type Snapshot } from "./schema";
import { download } from "./download";
import { today } from "./format";

const backupSchema = z.object({
  format: z.literal("mobile-shop-crm"), version: z.literal(1), exported_at: z.iso.datetime(),
  data: z.object({
    settings: schemas.settings.array().length(1), models: schemas.models.array(),
    phones: schemas.phones.array(), purchases: schemas.purchases.array(), customers: schemas.customers.array(),
    sales: schemas.sales.array(), returns: schemas.returns.array(), ledger_entries: schemas.ledger_entries.array(),
    audit_log: schemas.audit_log.array(),
  }), sync_queue: queueSchema.array(),
});

export async function exportBackup() {
  const backup = await db.transaction("r", db.tables.filter(t => t.name !== "device"), async () => ({
    format: "mobile-shop-crm", version: 1, exported_at: now(), data: await snapshot(), sync_queue: await db.sync_queue.toArray(),
  }));
  download("mobile-shop-backup-" + today() + ".json", new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  await db.device.put({ key: "lastBackup", value: backup.exported_at });
}

export async function importBackup(file: File) {
  if (file.size > 100_000_000) throw Error("Backup exceeds the 100 MB restore limit.");
  const backup = backupSchema.parse(JSON.parse(await file.text()));
  const data: Snapshot = backup.data;
  const ids = new Map(tables.map(table => [table, new Set(data[table].map(record => record.id))]));
  const exists = (table: keyof Snapshot, id: string) => ids.get(table)?.has(id);
  if (tables.some(table => ids.get(table)?.size !== data[table].length)
      || new Set(data.models.flatMap(m => m.tac_codes)).size !== data.models.reduce((sum, m) => sum + m.tac_codes.length, 0)
      || data.phones.some(p => !exists("models", p.model_id))
      || data.purchases.some(p => !exists("phones", p.phone_id) || !exists("models", p.model_id))
      || data.sales.some(s => !exists("customers", s.customer_id) || saleItems(s).some(item => !exists("phones", item.phone_id)))
      || data.returns.some(r => !exists("sales", r.sale_id) || !exists("phones", r.phone_id))
      || data.ledger_entries.some(e => !exists("sales", e.sale_id) || !exists(e.ref_type === "SALE" ? "sales" : "returns", e.ref_id))
      || backup.sync_queue.some(q => !exists(q.table, q.record_id))) throw Error("Backup has duplicate IDs or invalid record links.");
  await atomic(async () => {
    for (const table of tables) {
      await db.table(table).clear();
      await db.table(table).bulkAdd(data[table]);
    }
    await db.sync_queue.clear();
    await db.sync_queue.bulkAdd(backup.sync_queue);
  });
  await db.device.put({ key: "lastBackup", value: backup.exported_at });
}
