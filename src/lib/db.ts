import Dexie, { type Table } from "dexie";
import { queueSchema, schemas, type Meta, type Queue, type Records, type Snapshot, type TableName } from "./schema";

export const demoMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1";

class ShopDatabase extends Dexie {
  sync_queue!: Table<Queue, string>;
  device!: Table<{ key: string; value: string }, string>;

  constructor() {
    super(demoMode ? "mobile-shop-crm-demo" : "mobile-shop-crm");
    this.version(1).stores({
      settings: "id", models: "id,*tac_codes", phones: "id,&imei,status,model_id",
      purchases: "id,phone_id,purchase_date", customers: "id,&phone", sales: "id,&sale_no,phone_id,customer_id,bank_id,sale_date",
      returns: "id,&sale_id,phone_id", ledger_entries: "id,account,sale_id", audit_log: "id,timestamp",
      sync_queue: "id,&[table+record_id],created_at", device: "key",
    });
  }
  records<K extends TableName>(name: K): Table<Records[K], string> {
    return this.table<Records[K], string>(name);
  }
}

export const db = new ShopDatabase();
export const tables = Object.keys(schemas) as TableName[];
export const atomic = <T>(work: () => Promise<T>) => db.transaction("rw", db.tables.filter(t => t.name !== "device"), work);
export const now = () => new Date().toISOString();
export const meta = (previous?: Meta): Meta => ({
  id: previous?.id ?? crypto.randomUUID(), created_at: previous?.created_at ?? now(), updated_at: new Date(Math.max(Date.now(), previous ? Date.parse(previous.updated_at) + 1 : 0)).toISOString(), synced: false,
});

export async function put<K extends TableName>(table: K, fields: Omit<Records[K], keyof Meta>, previous?: Records[K]) {
  const record = schemas[table].parse({ ...fields, ...meta(previous) }) as Records[K];
  await db.records(table).put(record);
  const queued = await db.sync_queue.where("[table+record_id]").equals([table, record.id]).first();
  if (queued) await db.sync_queue.delete(queued.id);
  await db.sync_queue.add(queueSchema.parse({ ...meta(), table, record_id: record.id, operation: "UPSERT", ...(queued && { created_at: queued.created_at }) }));
  return record;
}

export async function snapshot(): Promise<Snapshot> {
  return db.transaction("r", tables.map(t => db.table(t)), async () => {
    const pairs = await Promise.all(tables.map(async t => [t, await db.table(t).toArray()]));
    return Object.fromEntries(pairs) as Snapshot;
  });
}

export async function audit(action: string, entity: TableName, entity_id: string, data: Record<string, unknown> = {}) {
  await put("audit_log", { action, entity, entity_id, data, timestamp: now() });
}

function hex(bytes: Uint8Array) {
  return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
}
async function hashPin(pin: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 600_000 }, key, 256);
  return hex(new Uint8Array(bits));
}
export const checkPin = async (pin: string, settings: Records["settings"]) => await hashPin(pin, settings.salt) === settings.pin_hash;

export async function setPin(pin: string, previousPin?: string) {
  if (pin.length < 4 || pin.length > 128) throw Error("Use 4 to 128 characters for the owner PIN or password.");
  const previous = await db.records("settings").toCollection().first();
  if (previous && !(await checkPin(previousPin ?? "", previous))) throw Error("Current PIN is incorrect.");
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const pin_hash = await hashPin(pin, salt);
  return atomic(async () => {
    const current = await db.records("settings").toCollection().first();
    if (current?.pin_hash !== previous?.pin_hash) throw Error("The owner PIN has changed. Please try again.");
    return put("settings", {
      shop: "Mobile Shop", address: "", phone: "", lock_minutes: 10,
      BANK_A: { company: "Company A", bank: "Bank A", title: "", number: "" },
      BANK_B: { company: "Company B", bank: "Bank B", title: "", number: "" },
      ...current, salt, pin_hash,
    }, current);
  });
}
