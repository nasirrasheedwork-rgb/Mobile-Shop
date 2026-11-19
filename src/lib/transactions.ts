import { atomic, audit, db, put } from "./db";
import { bankIds, banks, customerFields, date, modelFields, money, phoneFields, required, saleIncludesPhone, saleItems, text, type BankId, type CustomerFields, type ModelFields, type PhoneFields } from "./schema";
import { title } from "./format";

export async function saveModel(fields: ModelFields, id?: string) {
  const model = modelFields.parse({ ...fields, tac_codes: [...new Set(fields.tac_codes)] });
  return atomic(async () => {
    const previous = id ? await db.records("models").get(id) : undefined;
    if (id && !previous) throw Error("Model no longer exists.");
    for (const tac of model.tac_codes) {
      const owner = await db.records("models").where("tac_codes").equals(tac).first();
      if (owner && owner.id !== id) throw Error("TAC " + tac + " is already assigned to another model.");
    }
    const record = await put("models", model, previous);
    await audit(id ? "Model updated" : "Model added", "models", record.id, { model: title(record) });
    return record;
  });
}

export function linkModelTac(modelId: string, tac: string) {
  return atomic(async () => {
    const model = await db.records("models").get(modelId);
    if (!model) throw Error("Model no longer exists.");
    if (model.tac_codes.includes(tac)) return model;
    return saveModel({ ...model, tac_codes: [...model.tac_codes, tac] }, model.id);
  });
}

export function purchase(imeis: string[], fields: Omit<PhoneFields, "imei">) {
  if (!imeis.length || new Set(imeis).size !== imeis.length) throw Error("Scan one or more distinct IMEIs.");
  return atomic(async () => {
    const model = await db.records("models").get(fields.model_id);
    if (!model) throw Error("Select a catalog model.");
    for (const imei of imeis) {
      const details = phoneFields.parse({ ...fields, imei });
      const previous = await db.records("phones").where("imei").equals(imei).first();
      if (previous && !["SOLD", "RETURNED"].includes(previous.status)) throw Error(imei + " is already held in inventory.");
      const phone = await put("phones", { ...details, status: "IN_STOCK" }, previous);
      const record = await put("purchases", { ...details, phone_id: phone.id, label: title(model) });
      await audit("Purchase", "purchases", record.id, { imei, cost: fields.cost_price, supplier: fields.supplier });
    }
  });
}

export function checkoutCnic(value: string, financed: boolean) {
  const digits = value.trim().replace(/[\s-]/g, "");
  if (!digits && financed) throw Error("CNIC is required for a financed sale.");
  if (!/^\d{13}$/.test(digits)) {
    if (financed) throw Error("Enter a 13-digit CNIC, with or without dashes.");
    return value.trim();
  }
  return digits.slice(0, 5) + "-" + digits.slice(5, 12) + "-" + digits.slice(12);
}

export function sell(input: {
  customer: CustomerFields; cash: number; bank: BankId | ""; day: string;
} & ({ phoneId: string; total: number } | { items: { phoneId: string; price: number }[] })) {
  const lines = "items" in input ? input.items : [{ phoneId: input.phoneId, price: input.total }];
  if (!lines.length) throw Error("Scan at least one phone.");
  if (new Set(lines.map(line => line.phoneId)).size !== lines.length) throw Error("Each phone can only appear once on a sale.");
  const total = money.parse(lines.reduce((sum, line) => sum + money.parse(line.price), 0));
  const cash = money.parse(input.cash);
  const day = date.parse(input.day);
  if (cash > total) throw Error("Cash cannot exceed the sale price.");
  const amount = total - cash;
  if (amount && !input.bank) throw Error("Select a bank for the financed amount.");
  const bank = amount ? banks.parse(input.bank) : null;
  const details = customerFields.parse({
    ...input.customer,
    phone: input.customer.phone.replace(/[^\d+]/g, "").replace(/^(?:\+92|0092|92)(?=3\d{9}$)/, "0"),
    cnic: checkoutCnic(input.customer.cnic, amount > 0),
  });
  return atomic(async () => {
    const sold = await Promise.all(lines.map(async line => {
      const phone = await db.records("phones").get(line.phoneId);
      if (!phone || phone.status !== "IN_STOCK") throw Error("A phone on this sale is no longer in stock.");
      const model = await db.records("models").get(phone.model_id);
      return {
        phone,
        item: { phone_id: phone.id, phone_label: title(model), imei: phone.imei, color: phone.color,
          condition: phone.condition, storage: model?.storage ?? "", ram: model?.ram ?? "",
          specs: model?.specs ?? {}, price: line.price },
      };
    }));
    const first = sold[0].item;
    const existing = await db.records("customers").where("phone").equals(details.phone).first();
    const customer = await put("customers", details, existing);
    const sale_no = "S-" + String(await db.records("sales").count() + 1).padStart(4, "0");
    const sale = await put("sales", {
      sale_no, phone_id: first.phone_id, customer_id: customer.id, phone_label: first.phone_label,
      items: sold.map(({ item }) => item),
      receipt_details: {
        customer_cnic: customer.cnic, customer_address: customer.address,
        storage: first.storage, ram: first.ram, specs: first.specs,
      },
      imei: first.imei, phone_color: first.color, phone_condition: first.condition,
      customer_name: customer.name, customer_phone: customer.phone, total,
      cash_amount: cash, bank_id: bank, bank_amount: amount, bank_status: bank ? "PENDING" : null,
      received_date: null, reference_no: "", profit: total - sold.reduce((sum, { phone }) => sum + phone.cost_price, 0), status: "COMPLETED", sale_date: day,
    });
    for (const { phone } of sold) await put("phones", { ...phone, status: "SOLD" }, phone);
    const link = { type: "IN" as const, ref_type: "SALE" as const, ref_id: sale.id, sale_id: sale.id, date: day, reference_no: "" };
    if (cash) await put("ledger_entries", { ...link, account: "CASH", amount: cash, status: "RECEIVED", received_date: day });
    if (bank) await put("ledger_entries", { ...link, account: bank, amount, status: "PENDING", received_date: null });
    await audit("Sale", "sales", sale.id, { sale_no, total, cash, bank, amount });
    return sale;
  });
}

export function confirmBank(ids: string[], account: BankId, receive: boolean, day: string, ref: string) {
  date.parse(day);
  text.parse(ref);
  if (!ids.length || !bankIds.includes(account)) throw Error("Select sales for this bank.");
  return atomic(async () => {
    for (const id of new Set(ids)) {
      const sale = await db.records("sales").get(id);
      if (sale?.status !== "COMPLETED" || sale.bank_id !== account || sale.bank_status !== (receive ? "PENDING" : "RECEIVED")) {
        throw Error("A selected sale changed. Review the ledger and try again.");
      }
      if (receive && day < sale.sale_date) throw Error("Received date cannot precede the sale.");
      const entry = await db.records("ledger_entries").where("sale_id").equals(id).and(e => e.account === account && e.type === "IN").first();
      if (!entry) throw Error("Bank entry is missing.");
      const bank_status = receive ? "RECEIVED" : "PENDING";
      const received_date = receive ? day : null;
      const reference_no = receive ? ref : "";
      await put("sales", { ...sale, bank_status, received_date, reference_no }, sale);
      await put("ledger_entries", { ...entry, status: bank_status, received_date, reference_no }, entry);
      await audit(receive ? "Bank payment received" : "Bank payment reopened", "sales", id, { sale_no: sale.sale_no, account, received_date, reference_no });
    }
  });
}

export function returnPhone(input: { saleId: string; reason: string; day: string; refund: number; adjustment: number; defective: boolean; notes: string }) {
  const { day, refund, adjustment } = input;
  date.parse(day);
  money.parse(refund);
  money.parse(adjustment);
  required.parse(input.reason);
  return atomic(async () => {
    const sale = await db.records("sales").get(input.saleId);
    if (!sale || sale.status !== "COMPLETED") throw Error("Select the current completed sale.");
    const ids = saleItems(sale).map(item => item.phone_id);
    const phones = await db.records("phones").bulkGet(ids);
    const newer = await db.records("sales").filter(other => other.status === "COMPLETED"
      && other.created_at > sale.created_at && ids.some(id => saleIncludesPhone(other, id))).first();
    if (newer || phones.some(phone => phone?.status !== "SOLD")) throw Error("A phone from this sale is no longer sold under this receipt.");
    if (day < sale.sale_date) throw Error("Return date cannot precede the sale.");
    if (refund > sale.cash_amount || adjustment > (sale.bank_status === "RECEIVED" ? sale.bank_amount : 0)) throw Error("Refunds cannot exceed the collected amounts.");
    const disposition = input.defective ? "DEFECTIVE" : "IN_STOCK";
    const record = await put("returns", {
      sale_id: sale.id, phone_id: sale.phone_id, reason: input.reason, cash_refund: refund, bank_adjustment: adjustment,
      return_date: day, disposition, notes: input.notes,
    });
    for (const phone of phones) {
      if (phone) await put("phones", { ...phone, status: disposition }, phone);
    }
    const cancel = sale.bank_status === "PENDING";
    await put("sales", { ...sale, status: "RETURNED", bank_status: cancel ? "CANCELLED" : sale.bank_status }, sale);
    const link = { status: "RECEIVED" as const, ref_type: "RETURN" as const, ref_id: record.id, sale_id: sale.id, date: day, received_date: day, reference_no: "" };
    if (refund) await put("ledger_entries", { ...link, account: "CASH", type: "OUT", amount: refund });
    if (sale.bank_id && cancel) {
      const entry = await db.records("ledger_entries").where("sale_id").equals(sale.id).and(e => e.account === sale.bank_id && e.type === "IN").first();
      if (!entry) throw Error("Bank entry is missing.");
      await put("ledger_entries", { ...entry, status: "CANCELLED" }, entry);
    }
    if (sale.bank_id && adjustment) await put("ledger_entries", { ...link, account: sale.bank_id, type: "ADJUSTMENT", amount: adjustment });
    await audit("Return", "returns", record.id, { sale_no: sale.sale_no, refund, adjustment, disposition });
  });
}
