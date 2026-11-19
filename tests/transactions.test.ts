import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { checkPin, db, setPin, snapshot } from "../src/lib/db";
import { bankTotals, signed } from "../src/lib/format";
import { validImei } from "../src/lib/schema";
import { confirmBank, linkModelTac, purchase, returnPhone, saveModel, sell } from "../src/lib/transactions";

after(() => db.close());

test("rejects invalid IMEIs and reconciles financed sales and both return paths", async () => {
  const settings = await setPin("4826");
  assert.equal(await checkPin("4826", settings), true);
  assert.equal(await checkPin("0000", settings), false);
  const model = await saveModel({
    brand: "Samsung", model: "Galaxy A15", ram: "6 GB", storage: "128 GB",
    color: "Blue", specs: {}, tac_codes: ["49015420"], default_cost: 60, default_price: 100,
  });
  assert.deepEqual((await linkModelTac(model.id, "99000199")).tac_codes, ["49015420", "99000199"]);
  assert.equal((await db.records("models").where("tac_codes").equals("99000199").first())?.id, model.id);
  const imei = "490154203237518";
  const invalid = "123456789012345";
  assert.equal(validImei(imei), true);
  assert.equal(validImei(invalid), false);
  assert.equal((await db.records("models").where("tac_codes").equals(imei.slice(0, 8)).first())?.id, model.id);
  const day = "2026-11-19";
  const fields = {
    model_id: model.id, color: "Blue", condition: "New" as const, cost_price: 60,
    sale_price: 100, supplier: "Test", purchase_date: day, notes: "",
  };
  await purchase([imei], fields);
  await assert.rejects(purchase([imei], fields), /inventory/);
  await assert.rejects(purchase([invalid], fields), /Luhn/);

  const phone = (await snapshot()).phones[0];
  const customer = { name: "Test", phone: "03001234567", cnic: "1234512345671", address: "Sample address" };
  const financed = { phoneId: phone.id, customer, total: 100, cash: 20, bank: "BANK_A" as const, day };
  assert.throws(() => sell({ ...financed, cash: 101 }), /Cash cannot exceed the sale price/);
  assert.throws(() => sell({ ...financed, customer: { ...customer, cnic: "" } }), /CNIC is required/);
  assert.throws(() => sell({ ...financed, customer: { ...customer, cnic: "12345" } }), /13-digit CNIC/);
  assert.equal((await db.records("phones").get(phone.id))?.status, "IN_STOCK");
  const checkout = () => sell({ phoneId: phone.id, customer, total: 100, cash: 20, bank: "BANK_A", day });
  const ledger = async (account: string) => (await snapshot()).ledger_entries.filter(entry => entry.account === account);
  const cash = async () => (await ledger("CASH")).reduce((amount, entry) => amount + signed(entry), 0);

  const first = await checkout();
  assert.deepEqual(first.receipt_details, {
    customer_cnic: "12345-1234567-1", customer_address: "Sample address",
    storage: "128 GB", ram: "6 GB", specs: {},
  });
  assert.equal((await db.records("customers").get(first.customer_id))?.cnic, "12345-1234567-1");
  assert.deepEqual([first.total, first.cash_amount, first.bank_amount, first.bank_status, first.profit], [100, 20, 80, "PENDING", 40]);
  assert.deepEqual(bankTotals(await ledger("BANK_A")), { pending: 80, received: 0, total: 80 });
  assert.equal(await cash(), 20);

  await confirmBank([first.id], "BANK_A", true, day, "QA-001");
  assert.deepEqual(bankTotals(await ledger("BANK_A")), { pending: 0, received: 80, total: 80 });
  await confirmBank([first.id], "BANK_A", false, day, "");
  assert.deepEqual(bankTotals(await ledger("BANK_A")), { pending: 80, received: 0, total: 80 });

  const input = { day, reason: "Test return", refund: 20, adjustment: 0, defective: false, notes: "" };
  await returnPhone({ ...input, saleId: first.id });
  assert.equal((await db.records("sales").get(first.id))?.bank_status, "CANCELLED");
  assert.equal((await db.records("phones").get(phone.id))?.status, "IN_STOCK");

  const second = await checkout();
  await confirmBank([second.id], "BANK_A", true, day, "QA-002");
  await returnPhone({ ...input, saleId: second.id, adjustment: 80 });
  assert.equal((await ledger("BANK_A")).find(entry => entry.type === "ADJUSTMENT")?.amount, 80);
  assert.deepEqual(bankTotals(await ledger("BANK_A")), { pending: 0, received: 0, total: 0 });
  assert.equal(await cash(), 0);
  assert.equal((await snapshot()).sales.length, 2);
  const fullCash = await sell({ phoneId: phone.id, customer: { ...customer, phone: "03001234568", cnic: "" }, total: 100, cash: 100, bank: "", day });
  assert.deepEqual([fullCash.cash_amount, fullCash.bank_amount, fullCash.bank_status], [100, 0, null]);
  assert.ok(await db.sync_queue.count() > 0);
});
