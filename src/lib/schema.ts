import { z } from "zod";

export const bankIds = ["BANK_A", "BANK_B"] as const;
export const banks = z.enum(bankIds);
export type BankId = z.infer<typeof banks>;
export const date = z.iso.date();
export const money = z.number().int().nonnegative().max(100_000_000);
export const uuid = z.uuid();
export const text = z.string().max(2000);
export const required = text.trim().min(1);

export function validImei(value: string) {
  return /^\d{15}$/.test(value) && [...value].reduce((sum, digit, index) => {
    const n = Number(digit) * (index % 2 + 1);
    return sum + (n > 9 ? n - 9 : n);
  }, 0) % 10 === 0;
}
export const imei = z.string().refine(validImei, "IMEI must have 15 digits and a valid Luhn check digit.");

const meta = {
  id: uuid, created_at: z.iso.datetime(), updated_at: z.iso.datetime(), synced: z.boolean(),
};
const company = z.object({ company: required, bank: required, title: text, number: text });
export const modelFields = z.object({
  brand: required, model: required, storage: text, ram: text, color: text,
  specs: z.record(z.string(), z.string()), tac_codes: z.array(z.string().regex(/^\d{8}$/)),
  default_cost: money, default_price: money,
});
export const phoneFields = z.object({
  imei, model_id: uuid, color: text, condition: z.enum(["New", "Used"]),
  cost_price: money, sale_price: money, supplier: required, purchase_date: date, notes: text,
});
export const customerFields = z.object({ name: required, phone: required, cnic: text, address: text });
const saleItem = z.object({
  phone_id: uuid, phone_label: required, imei, color: text, condition: text,
  storage: text, ram: text, specs: z.record(z.string(), z.string()), price: money,
});

export const schemas = {
  settings: z.object({
    ...meta, shop: required, address: text, phone: text, BANK_A: company, BANK_B: company,
    pin_hash: z.string().regex(/^[a-f0-9]{64}$/), salt: z.string().regex(/^[a-f0-9]{32}$/),
    lock_minutes: z.number().int().min(1).max(1440),
  }),
  models: modelFields.extend(meta),
  phones: phoneFields.extend({ ...meta, status: z.enum(["IN_STOCK", "SOLD", "RETURNED", "DEFECTIVE"]) }),
  purchases: phoneFields.extend({ ...meta, phone_id: uuid, label: required }),
  customers: customerFields.extend(meta),
  sales: z.object({
    ...meta, sale_no: required, phone_id: uuid, customer_id: uuid, phone_label: required, imei,
    phone_color: text, phone_condition: text, customer_name: required, customer_phone: required,
    items: z.array(saleItem).nonempty().optional(),
    receipt_details: z.object({
      customer_cnic: text, customer_address: text, storage: text, ram: text, specs: z.record(z.string(), z.string()),
    }).optional(),
    total: money, cash_amount: money, bank_id: banks.nullable(), bank_amount: money,
    bank_status: z.enum(["PENDING", "RECEIVED", "CANCELLED"]).nullable(),
    received_date: date.nullable(), reference_no: text, profit: z.number().int(),
    status: z.enum(["COMPLETED", "RETURNED"]), sale_date: date,
  }).refine(sale => sale.total === sale.cash_amount + sale.bank_amount
    && (sale.bank_amount > 0 ? !!sale.bank_id && !!sale.bank_status : sale.bank_status === null)
    && (!sale.items || (
      sale.items[0].phone_id === sale.phone_id && sale.items[0].imei === sale.imei
      && new Set(sale.items.map(item => item.phone_id)).size === sale.items.length
      && sale.items.reduce((sum, item) => sum + item.price, 0) === sale.total
    ))),
  returns: z.object({
    ...meta, sale_id: uuid, phone_id: uuid, reason: required, cash_refund: money, bank_adjustment: money,
    return_date: date, disposition: z.enum(["IN_STOCK", "DEFECTIVE"]), notes: text,
  }),
  ledger_entries: z.object({
    ...meta, account: z.enum(["CASH", ...bankIds]), type: z.enum(["IN", "OUT", "ADJUSTMENT"]),
    amount: money, status: z.enum(["PENDING", "RECEIVED", "CANCELLED"]), ref_type: z.enum(["SALE", "RETURN"]),
    ref_id: uuid, sale_id: uuid, date, received_date: date.nullable(), reference_no: text,
  }),
  audit_log: z.object({ ...meta, action: required, entity: required, entity_id: uuid, data: z.record(z.string(), z.unknown()), timestamp: z.iso.datetime() }),
};
export const queueSchema = z.object({
  ...meta, table: z.enum(Object.keys(schemas) as [keyof typeof schemas, ...(keyof typeof schemas)[]]),
  record_id: uuid, operation: z.literal("UPSERT"),
});
export type TableName = keyof typeof schemas;
export type Records = { [K in TableName]: z.infer<(typeof schemas)[K]> };
export type Meta = z.infer<z.ZodObject<typeof meta>>;
export type Model = Records["models"];
export type Phone = Records["phones"];
export type Sale = Records["sales"];

export function saleItems(sale: Sale): z.infer<typeof saleItem>[] {
  return sale.items ?? [{
    phone_id: sale.phone_id, phone_label: sale.phone_label, imei: sale.imei,
    color: sale.phone_color, condition: sale.phone_condition, price: sale.total,
    storage: sale.receipt_details?.storage ?? "", ram: sale.receipt_details?.ram ?? "",
    specs: sale.receipt_details?.specs ?? {},
  }];
}

export function saleIncludesPhone(sale: Sale, phoneId: string) {
  return sale.items ? sale.items.some(item => item.phone_id === phoneId) : sale.phone_id === phoneId;
}
export type Settings = Records["settings"];
export type Entry = Records["ledger_entries"];
export type Queue = z.infer<typeof queueSchema>;
export type ModelFields = z.infer<typeof modelFields>;
export type PhoneFields = z.infer<typeof phoneFields>;
export type CustomerFields = z.infer<typeof customerFields>;
export type Snapshot = { [K in TableName]: Records[K][] };
