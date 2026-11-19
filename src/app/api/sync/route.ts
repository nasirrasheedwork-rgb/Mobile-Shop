import { timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import { z } from "zod";
import { schemas, type TableName } from "@/lib/schema";

export const runtime = "nodejs";
let pool: Pool | undefined;
const batch = z.array(z.object({
  table: z.enum(Object.keys(schemas) as [TableName, ...TableName[]]),
  record: z.unknown(),
})).min(1).max(50);

function quoteIdentifier(value: string) {
  return '"' + value.replaceAll('"', '""') + '"';
}

const upsert = Object.fromEntries((Object.keys(schemas) as TableName[]).map(table => {
  const name = quoteIdentifier(table);
  const updates = Object.keys(schemas[table].shape).filter(field => field !== "id" && field !== "created_at")
    .map(field => {
      const column = quoteIdentifier(field);
      return column + " = EXCLUDED." + column;
    });
  return [table, `
    INSERT INTO ${name}
    SELECT * FROM jsonb_populate_record(NULL::${name}, $1::jsonb)
    ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")}
    WHERE ${name}.updated_at <= EXCLUDED.updated_at
  `];
})) as Record<TableName, string>;

export async function POST(request: Request) {
  const expected = process.env.SYNC_TOKEN;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !expected || expected.length < 24) return Response.json({ error: "Cloud sync is not configured on the server." }, { status: 503 });
  const sent = Buffer.from(request.headers.get("authorization") ?? "");
  const wanted = Buffer.from("Bearer " + expected);
  if (sent.length !== wanted.length || !timingSafeEqual(sent, wanted)) return Response.json({ error: "Cloud sync token is invalid." }, { status: 401 });
  const raw = await request.text();
  if (raw.length > 2_000_000) return Response.json({ error: "Sync batch is too large." }, { status: 413 });
  let records;
  try {
    records = batch.parse(JSON.parse(raw)).map(({ table, record }) => ({ table, record: schemas[table].parse(record) }));
  } catch {
    return Response.json({ error: "Sync batch contains invalid records." }, { status: 400 });
  }
  try {
    pool ??= new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000 });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const { table, record } of records) {
        await client.query(upsert[table], [JSON.stringify({ ...record, synced: true })]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return Response.json({ uploaded: records.length });
  } catch {
    return Response.json({ error: "PostgreSQL could not accept the sync batch. Check the connection and apply sql/cloud.sql." }, { status: 503 });
  }
}
