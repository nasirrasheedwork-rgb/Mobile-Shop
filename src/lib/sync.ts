import { atomic, db, demoMode, now } from "./db";
import type { Meta } from "./schema";

let active: Promise<number> | undefined;
export function sync() {
  if (active) return active;
  active = upload().finally(() => { active = undefined; });
  return active;
}

async function upload() {
  if (demoMode) throw Error("Demo records stay in this browser.");
  if (!navigator.onLine) throw Error("Sync is unavailable while offline.");
  const token = (await db.device.get("syncToken"))?.value;
  if (!token) throw Error("Set the cloud sync token in Command Center → Sync.");
  let count = 0;
  for (;;) {
    const batch = await db.transaction("r", db.tables.filter(t => t.name !== "device"), async () => {
      const queue = await db.sync_queue.orderBy("created_at").limit(50).toArray();
      return Promise.all(queue.map(async item => ({ item, record: await db.table<Meta>(item.table).get(item.record_id) })));
    });
    if (!batch.length) break;
    const response = await fetch("/api/sync", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(batch.map(({ item, record }) => ({ table: item.table, record }))),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw Error(body.error || "Cloud sync failed. Your changes are still saved on this device.");
    }
    await atomic(async () => {
      for (const { item } of batch) {
        const current = await db.sync_queue.get(item.id);
        if (!current) continue;
        await db.table(item.table).update(item.record_id, { synced: true });
        await db.sync_queue.delete(item.id);
      }
    });
    count += batch.length;
  }
  await db.device.put({ key: "lastSync", value: now() });
  return count;
}
