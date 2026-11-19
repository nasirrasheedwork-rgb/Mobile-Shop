import { db, demoMode, put, setPin } from "./db";
import { shiftDay, today } from "./format";
import type { BankId } from "./schema";
import { confirmBank, purchase, returnPhone, saveModel, sell } from "./transactions";

export const demoPin = "1234";

const catalog = [
  { brand: "Samsung", model: "Galaxy A15", storage: "128 GB", ram: "6 GB", color: "Blue Black", cost: 42500, price: 48900, count: 5, supplier: "Metro Mobile Wholesale", screen: "Super AMOLED" },
  { brand: "Apple", model: "iPhone 13", storage: "128 GB", ram: "4 GB", color: "Midnight", cost: 105000, price: 124000, count: 3, supplier: "City Trade Phones", screen: "Super Retina XDR" },
  { brand: "Xiaomi", model: "Redmi Note 13", storage: "256 GB", ram: "8 GB", color: "Mint Green", cost: 41400, price: 46500, count: 4, supplier: "Metro Mobile Wholesale", screen: "AMOLED" },
  { brand: "OPPO", model: "A58", storage: "128 GB", ram: "8 GB", color: "Glowing Black", cost: 38800, price: 45000, count: 3, supplier: "Gulberg Phone Distribution", screen: "FHD+ LCD" },
  { brand: "Infinix", model: "Hot 40", storage: "256 GB", ram: "8 GB", color: "Horizon Gold", cost: 32200, price: 37900, count: 3, supplier: "Gulberg Phone Distribution", screen: "90 Hz LCD" },
];

const examples: {
  name: string; model: number; unit: number; daysAgo: number; cash: number; bank: BankId | "";
  received?: boolean; returned?: "stock" | "defective";
}[] = [
  { name: "Hamza Khan", model: 0, unit: 0, daysAgo: 24, cash: 15000, bank: "BANK_A" },
  { name: "Mariam Ali", model: 1, unit: 0, daysAgo: 20, cash: 44000, bank: "BANK_B", received: true },
  { name: "Bilal Ahmed", model: 2, unit: 0, daysAgo: 16, cash: 18000, bank: "BANK_A", returned: "stock" },
  { name: "Sara Iqbal", model: 3, unit: 0, daysAgo: 12, cash: 13000, bank: "BANK_A", received: true },
  { name: "Ayesha Malik", model: 4, unit: 0, daysAgo: 9, cash: 10000, bank: "BANK_B", received: true, returned: "defective" },
  { name: "Hassan Raza", model: 0, unit: 1, daysAgo: 6, cash: 20000, bank: "BANK_B" },
  { name: "Noor Siddiqui", model: 2, unit: 1, daysAgo: 3, cash: 46500, bank: "" },
  { name: "Omar Shah", model: 1, unit: 1, daysAgo: 0, cash: 40000, bank: "BANK_A" },
  { name: "Zainab Sheikh", model: 4, unit: 1, daysAgo: 0, cash: 37900, bank: "" },
];

function sampleImei(tac: string, index: number) {
  const digits = tac + String(index + 1).padStart(6, "0");
  const sum = [...digits].reduce((total, digit, offset) => {
    const weighted = Number(digit) * (offset % 2 + 1);
    return total + (weighted > 9 ? weighted - 9 : weighted);
  }, 0);
  return digits + (10 - sum % 10) % 10;
}

let setup: Promise<void> | undefined;

export function prepareDemo() {
  if (!demoMode) return Promise.resolve();
  setup ??= seed().catch(error => {
    setup = undefined;
    throw error;
  });
  return setup;
}

async function seed() {
  const existingSettings = await db.records("settings").toCollection().first();
  if (!existingSettings) {
    try {
      await setPin(demoPin);
    } catch (error) {
      // Another demo tab may have initialized the PIN while this tab was hashing it.
      if (!(await db.records("settings").count())) throw error;
    }
  }

  await db.transaction("rw", db.tables, async () => {
    if (await db.device.get("demoSeeded")) return;
    const settings = await db.records("settings").toCollection().first();
    if (!settings) throw Error("Demo setup could not create shop settings.");
    if (await db.records("phones").count()) throw Error("This demo profile already has phone records.");
    await put("settings", {
      ...settings, shop: "Mobile Shop Demo", address: "Main Boulevard, Lahore · Sample address",
      phone: "0300 000 0000", BANK_A: { ...settings.BANK_A, company: "Metro Finance" },
      BANK_B: { ...settings.BANK_B, company: "City Finance" },
    }, settings);

    const day = today();
    const batches: string[][] = [];
    for (const [index, item] of catalog.entries()) {
      const tac = String(99000101 + index);
      const model = await saveModel({
        brand: item.brand, model: item.model, storage: item.storage, ram: item.ram, color: item.color,
        default_cost: item.cost, default_price: item.price, specs: { Display: item.screen }, tac_codes: [tac],
      });
      const imeis = Array.from({ length: item.count }, (_, unit) => sampleImei(tac, unit));
      await purchase(imeis, {
        model_id: model.id, color: item.color, condition: index === 1 ? "Used" : "New",
        cost_price: item.cost, sale_price: item.price, supplier: item.supplier,
        purchase_date: shiftDay(day, -28 + index), notes: "Sample stock",
      });
      batches.push(imeis);
    }

    for (const [index, example] of examples.entries()) {
      const phone = await db.records("phones").where("imei").equals(batches[example.model][example.unit]).first();
      if (!phone) throw Error("Demo checkout could not find its sample phone.");
      const saleDay = shiftDay(day, -example.daysAgo);
      const sale = await sell({
        phoneId: phone.id, total: phone.sale_price, cash: example.cash, bank: example.bank, day: saleDay,
        customer: { name: example.name, phone: "0300" + String(index + 1).padStart(7, "0"), cnic: example.bank ? "00000-" + String(index + 1).padStart(7, "0") + "-0" : "", address: "" },
      });
      if (example.received && example.bank) {
        await confirmBank([sale.id], example.bank, true, shiftDay(saleDay, 2), "DEMO-" + sale.sale_no);
      }
      if (example.returned) {
        await returnPhone({
          saleId: sale.id, day: shiftDay(saleDay, 3), reason: example.returned === "defective" ? "Display fault" : "Customer changed model",
          refund: sale.cash_amount, adjustment: example.received ? sale.bank_amount : 0,
          defective: example.returned === "defective", notes: "Sample return",
        });
      }
    }

    await db.device.put({ key: "demoSeeded", value: "1" });
  });
}
