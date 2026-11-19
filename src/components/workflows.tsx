"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Barcode, Check, Plus, Search } from "lucide-react";
import { db } from "@/lib/db";
import { matches, pkr, showDate, title, today } from "@/lib/format";
import { bankIds, modelFields, saleIncludesPhone, saleItems, validImei, type BankId, type Model, type ModelFields, type Phone, type Sale, type Settings, type Snapshot } from "@/lib/schema";
import { checkoutCnic, linkModelTac, purchase, returnPhone, saveModel, sell } from "@/lib/transactions";
import { Badge, Button, Empty, Field, Modal, field, type Run } from "./ui";

export function ModelForm({ existing, initial, scannedTac, onSave, run }: {
  existing?: Model; initial?: Partial<ModelFields>; scannedTac?: string; onSave: (model: Model) => void; run: Run;
}) {
  const model = existing ?? initial;
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(async () => {
      const specs = Object.fromEntries(field(f, "specs").split("\n").filter(Boolean).map(line => {
        const separator = line.indexOf(":");
        if (separator < 1) throw Error("Enter each additional spec as Name: value.");
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }));
      onSave(await saveModel({
        brand: field(f, "brand"), model: field(f, "model"), storage: field(f, "storage"), ram: field(f, "ram"),
        color: field(f, "color"), default_cost: Number(field(f, "cost")), default_price: Number(field(f, "price")),
        tac_codes: scannedTac ? [scannedTac] : field(f, "tac").split(/[\s,]+/).filter(Boolean), specs,
      }, existing?.id));
    });
  }
  return <form className="grid-form" onSubmit={submit}>
    <Field name="Brand"><input data-dialog-focus name="brand" required defaultValue={model?.brand} /></Field>
    <Field name="Model"><input name="model" required defaultValue={model?.model} /></Field>
    <Field name="Storage"><input name="storage" placeholder="128 GB" defaultValue={model?.storage} /></Field>
    <Field name="RAM"><input name="ram" placeholder="6 GB" defaultValue={model?.ram} /></Field>
    <Field name="Default color"><input name="color" defaultValue={model?.color} /></Field>
    <Field name={scannedTac ? "TAC from scanned IMEI" : "TAC codes (optional)"}>
      <input name="tac" readOnly={!!scannedTac} defaultValue={scannedTac ?? model?.tac_codes?.join(", ")} placeholder="First 8 IMEI digits" />
    </Field>
    <Field name="Default cost (PKR)"><input type="number" min="0" name="cost" required defaultValue={model?.default_cost ?? 0} /></Field>
    <Field name="Default sale price (PKR)"><input type="number" min="0" name="price" required defaultValue={model?.default_price ?? 0} /></Field>
    <Field name="Other specs" wide><textarea name="specs" placeholder="Display: AMOLED" defaultValue={Object.entries(model?.specs ?? {}).map(([key, value]) => key + ": " + value).join("\n")} /></Field>
    <div className="wide actions"><Button type="submit" className="primary">Save model</Button></div>
  </form>;
}

function Scan({ text, setText, lookup, hint, inputRef }: {
  text: string; setText: (next: string) => void; lookup: () => void; hint: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  useEffect(() => { inputRef.current?.focus(); }, [inputRef]);
  return <form className="scan" onSubmit={e => { e.preventDefault(); lookup(); }}>
    <div className="scan-icon"><Barcode size={22} /></div>
    <label><span>Scan or search</span><input ref={inputRef} value={text} onChange={e => setText(e.target.value)} placeholder={hint} spellCheck={false} /></label>
    <Button type="submit" className="primary"><Search size={16} /> Look up</Button>
  </form>;
}

function ModelSpecs({ model }: { model: Model }) {
  const details = [
    model.storage && "Storage: " + model.storage,
    model.ram && "RAM: " + model.ram,
    ...Object.entries(model.specs).map(([name, value]) => name + ": " + value),
  ].filter(Boolean);
  return details.length ? <div className="wide spec-strip">{details.join(" · ")}</div> : null;
}

export function Purchase({ data, run, done }: { data: Snapshot; run: Run; done: (message: string) => void }) {
  const [scan, setScan] = useState("");
  const [imeis, setImeis] = useState<string[]>([]);
  const [modelId, setModelId] = useState("");
  const [draft, setDraft] = useState<{ imei: string; fields: Partial<ModelFields>; addNew: boolean }>();
  const [detected, setDetected] = useState(false);
  const [revision, setRevision] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const model = data.models.find(m => m.id === modelId);
  const suppliers = [...new Set(data.purchases.map(p => p.supplier))].sort();
  const catalog = [...data.models].sort((a, b) => title(a).localeCompare(title(b)));
  const modelOptions = catalog.map(m => <option key={m.id} value={m.id}>{title(m)}</option>);

  function add(imei: string, model: Model, autoDetected = false) {
    setDetected(autoDetected);
    setModelId(model.id);
    setImeis(current => [...current, imei]);
    setScan("");
    input.current?.focus();
  }
  const lookup = (createModel = false) => run(async () => {
    const imei = scan.trim();
    if (!validImei(imei)) {
      if (createModel) { setDraft({ imei: "", fields: {}, addNew: true }); return; }
      throw Error("IMEI must have 15 digits and a valid Luhn check digit.");
    }
    const duplicate = await db.records("phones").where("imei").equals(imei).first();
    if (imeis.includes(imei) || duplicate && !["SOLD", "RETURNED"].includes(duplicate.status)) throw Error("This IMEI is already in the batch or held in inventory.");
    const tac = imei.slice(0, 8);
    const known = await db.records("models").where("tac_codes").equals(tac).first();
    if (known) {
      if (createModel) throw Error("This IMEI already matches " + title(known) + ". Use Look up to add it to stock.");
      if (imeis.length && known.id !== modelId) throw Error("Save the current batch before scanning a different model.");
      add(imei, known, true);
      return;
    }
    if (imeis.length) throw Error("Save the current batch before adding a different TAC.");
    let fields: Partial<ModelFields> = {};
    if (navigator.onLine) {
      try {
        const result = await fetch("/api/tac?tac=" + tac, { signal: AbortSignal.timeout(3800) });
        if (result.ok) {
          const parsed = modelFields.safeParse(await result.json());
          if (parsed.success) fields = parsed.data;
        }
      } catch { /* The editable catalog form is available offline. */ }
    }
    setDraft({ imei, fields: { ...fields, tac_codes: [tac] }, addNew: createModel || !catalog.length });
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(async () => {
      await purchase(imeis, {
        model_id: modelId, color: field(f, "color"), condition: field(f, "condition") as "New" | "Used",
        cost_price: Number(field(f, "cost")), sale_price: Number(field(f, "price")), supplier: field(f, "supplier"),
        purchase_date: field(f, "day"), notes: field(f, "notes"),
      });
      done(imeis.length + (imeis.length === 1 ? " phone added to stock." : " phones added to stock."));
      setImeis([]); setModelId(""); setDetected(false); setRevision(n => n + 1); input.current?.focus();
    });
  }

  return <div className="stack">
    <Scan text={scan} setText={setScan} lookup={() => lookup()} hint="Scan or enter a 15-digit IMEI, then press Enter" inputRef={input} />
    <section className="panel">
      <div className="section-head"><div><h2>Stock intake</h2><p>Scan or enter the IMEI, then select or add a model if it’s unknown.</p></div>
        <Button className="primary" disabled={imeis.length > 0} onClick={() => lookup(true)}><Plus size={16} /> Add new model</Button>
      </div>
      <form className="grid-form" onSubmit={submit} key={modelId + revision}>
        <Field name="Catalog model" wide><select required value={modelId} disabled={imeis.length > 0} onChange={e => { setModelId(e.target.value); setDetected(false); }}>
          <option value="">Select a model</option>{modelOptions}
        </select></Field>
        {detected && model && imeis.length > 0 && <p className="wide" role="status">Model detected from IMEI: <strong>{title(model)}</strong></p>}
        {model && <ModelSpecs model={model} />}
        <div className="wide chips">{imeis.map(imei => <Button key={imei} className="chip" title="Remove IMEI" onClick={() => setImeis(list => list.filter(value => value !== imei))}>{imei} ×</Button>)}</div>
        <Field name="Color"><input name="color" defaultValue={model?.color} /></Field>
        <Field name="Condition"><select name="condition"><option>New</option><option>Used</option></select></Field>
        <Field name="Unit cost (PKR)"><input type="number" name="cost" min="0" required defaultValue={model?.default_cost} /></Field>
        <Field name="Sale price (PKR)"><input type="number" name="price" min="0" required defaultValue={model?.default_price} /></Field>
        <Field name="Supplier"><input name="supplier" list="suppliers" required /><datalist id="suppliers">{suppliers.map(s => <option key={s} value={s} />)}</datalist></Field>
        <Field name="Purchase date"><input name="day" type="date" defaultValue={today()} required /></Field>
        <Field name="Notes" wide><textarea name="notes" /></Field>
        <div className="actions wide"><Button type="submit" className="primary" disabled={!imeis.length}>Save purchase {imeis.length > 0 && "(" + imeis.length + ")"}</Button></div>
      </form>
    </section>
    {draft && <Modal key={draft.addNew ? "add" : "choose"} title={draft.addNew ? "Add new model" : "Select model for scanned IMEI"}
      close={() => { setDraft(undefined); requestAnimationFrame(() => input.current?.focus()); }}>
      {draft.addNew ? <>
        <p>{draft.imei
          ? "IMEI " + draft.imei + " will be added to this purchase. Future scans with the same IMEI prefix will fill in these details."
          : "Save the model now, then scan or enter a valid IMEI to link it and add a phone to stock."}</p>
        <ModelForm initial={draft.fields} scannedTac={draft.imei.slice(0, 8) || undefined} run={run} onSave={m => {
          if (draft.imei) add(draft.imei, m);
          else { setModelId(m.id); setDetected(false); }
          done("Model saved.");
          setDraft(undefined);
          requestAnimationFrame(() => input.current?.focus());
        }} />
        {draft.imei && catalog.length > 0 && <Button onClick={() => setDraft({ ...draft, addNew: false })}>Choose an existing model</Button>}
      </> : <>
        <p>IMEI {draft.imei}. Choose the matching model to remember it for future scans.</p>
        {draft.fields.model && <p>Lookup result: {[draft.fields.brand, draft.fields.model, draft.fields.storage].filter(Boolean).join(" ")}</p>}
        <form className="grid-form" onSubmit={e => {
          e.preventDefault();
          const id = field(new FormData(e.currentTarget), "catalogModel");
          void run(async () => {
            const model = await linkModelTac(id, draft.imei.slice(0, 8));
            add(draft.imei, model); setDraft(undefined); requestAnimationFrame(() => input.current?.focus());
          });
        }}>
          <Field name="Matching catalog model" wide><select data-dialog-focus name="catalogModel" required defaultValue={modelId}>
            <option value="">Select a model</option>{modelOptions}
          </select></Field>
          <div className="wide actions">
            <Button onClick={() => setDraft({ ...draft, addNew: true })}>Add new model</Button>
            <Button type="submit" className="primary">Use selected model</Button>
          </div>
        </form>
      </>}
    </Modal>}
  </div>;
}

function PhoneSearch({ data, mode, run, onSelect }: {
  data: Snapshot; mode: "IN_STOCK" | "SOLD"; run: Run; onSelect: (phone: Phone) => void;
}) {
  const [scan, setScan] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const getModel = (phone: Phone) => data.models.find(m => m.id === phone.model_id);
  const results = scan.trim() ? data.phones.filter(p => p.status === mode && matches(scan, title(getModel(p)), p.imei, p.color)).slice(0, 12) : [];
  const select = (phone: Phone) => {
    onSelect(phone);
    setScan("");
    input.current?.focus();
  };

  return <>
    <Scan text={scan} setText={setScan} inputRef={input} hint="Scan IMEI or search by phone model" lookup={() => run(async () => {
      const query = scan.trim();
      if (/^\d{8,}$/.test(query) && !validImei(query)) throw Error("IMEI must have 15 digits and a valid Luhn check digit.");
      const exact = results.find(p => p.imei === query);
      if (exact) select(exact);
      else if (!/^\d{15}$/.test(query) && results.length === 1) select(results[0]);
      else if (!results.length) throw Error(mode === "SOLD" ? "No sold phone matches this search." : "No in-stock phone matches this search.");
    })} />
    {scan.trim() && <div className="search-results">{results.length ? results.map(p => <button key={p.id} className="search-result" onClick={() => select(p)}><span><b>{title(getModel(p))}</b><small>{p.imei} · {p.color} · {p.condition}</small></span><span><strong>{pkr(p.sale_price)}</strong>{mode === "IN_STOCK" && <small>Add to sale</small>}</span></button>) : <Empty>No matching phones.</Empty>}</div>}
  </>;
}

function CustomerPhonePicker({ customers, value, onChange, onSelect }: {
  customers: Snapshot["customers"]; value: string; onChange: (value: string) => void;
  onSelect: (value: string) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const search = /^[\d\s()+-]*$/.test(value)
    ? value.replace(/[\s()-]/g, "").replace(/^(?:\+92|0092|92)(?=3)/, "0")
    : value;
  const suggestions = customers.filter(c => matches(search, c.phone, c.name)).slice(0, 8);
  const expanded = open && suggestions.length > 0;

  function select(phone: string) {
    setOpen(false);
    setActive(-1);
    onSelect(phone);
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length) {
      event.preventDefault();
      setOpen(true);
      setActive(current => event.key === "ArrowDown"
        ? Math.min(current + 1, suggestions.length - 1)
        : current < 0 ? suggestions.length - 1 : Math.max(current - 1, 0));
    } else if (event.key === "Enter" && expanded) {
      event.preventDefault();
      const option = suggestions[active] ?? (suggestions.length === 1 ? suggestions[0] : undefined);
      if (option) select(option.phone);
    }
  }

  return <div className="customer-picker">
    <Field name="Customer phone"><input required type="tel" autoComplete="off" role="combobox" aria-autocomplete="list"
      aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
      aria-activedescendant={expanded && suggestions[active] ? listId + "-" + active : undefined}
      value={value} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
      onBlur={() => { setOpen(false); setActive(-1); }} onKeyDown={handleKey}
      onChange={event => { setActive(-1); setOpen(true); onChange(event.target.value); }}
    /></Field>
    {expanded && <div id={listId} className="customer-options" role="listbox" aria-label="Saved customers">
      {suggestions.map((customer, index) => <button key={customer.id} id={listId + "-" + index}
        className="customer-option" type="button" role="option" aria-selected={active === index} tabIndex={-1}
        onMouseDown={event => event.preventDefault()} onClick={() => select(customer.phone)}>
        <strong>{customer.phone}</strong><span>{customer.name}</span>
      </button>)}
    </div>}
  </div>;
}

export function Checkout({ data, settings, run, done, receipt }: {
  data: Snapshot; settings: Settings; run: Run; done: (msg: string) => void; receipt: (sale: Sale) => void;
}) {
  const [items, setItems] = useState<{ phone: Phone; price: string }[]>([]);
  const [cashInput, setCashInput] = useState("");
  const [cashCapped, setCashCapped] = useState(false);
  const [selectedBank, setSelectedBank] = useState<BankId | "">("");
  const [customer, setCustomer] = useState({ name: "", phone: "", cnic: "", address: "" });
  const autofilledCustomer = useRef(false);
  const customerName = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<Extract<Parameters<typeof sell>[0], { items: unknown }>>();
  const total = items.reduce((sum, item) => sum + Number(item.price), 0);
  const cashLimit = Math.max(0, total);
  const priceLimitsCash = Number(cashInput) > cashLimit;
  const cash = priceLimitsCash ? String(cashLimit) : cashInput;
  const amount = total - Number(cash);
  const financed = amount > 0;
  const getModel = (phone: Phone) => data.models.find(model => model.id === phone.model_id);

  function updateCash(value: string) {
    const exceedsTotal = Number(value) > cashLimit;
    setCashInput(exceedsTotal ? String(cashLimit) : value);
    setCashCapped(exceedsTotal);
  }

  function commitPrice() {
    if (items.every(item => item.price !== "") && priceLimitsCash) {
      setCashInput(cash);
      setCashCapped(true);
    }
  }

  function applyCustomer(value: string) {
    const digits = value.replace(/[^\d+]/g, "").replace(/^(?:\+92|0092|92)(?=3\d{9}$)/, "0");
    const found = data.customers.find(c => c.phone === digits);
    const clearPrevious = autofilledCustomer.current && !found;
    autofilledCustomer.current = !!found;
    setCustomer(current => {
      if (found) {
        const cnic = /^\d{0,13}$/.test(found.cnic.replace(/[\s-]/g, "")) ? found.cnic : "";
        return { name: found.name, phone: found.phone, cnic, address: found.address };
      }
      if (clearPrevious) return { name: "", phone: value, cnic: "", address: "" };
      return { ...current, phone: value };
    });
  }

  return <div className="stack">
    <PhoneSearch data={data} mode="IN_STOCK" run={run} onSelect={phone => {
      if (items.some(item => item.phone.id === phone.id)) {
        done("This IMEI is already on the sale.");
        return;
      }
      setItems(current => [...current, { phone, price: String(phone.sale_price) }]);
    }} />
    {!items.length ? <section className="panel"><Empty>Scan or search for an in-stock phone to start checkout.</Empty></section> : <section className="panel">
      <div className="section-head"><div><h2>Phones on this sale ({items.length})</h2><p>Scan or choose another phone to add it to the same receipt.</p></div></div>
      <form className="grid-form" autoComplete="off" onSubmit={e => {
        e.preventDefault();
        const fields = new FormData(e.currentTarget);
        void run(async () => {
          const cnic = checkoutCnic(customer.cnic, financed);
          setReview({ items: items.map(({ phone, price }) => ({ phoneId: phone.id, price: Number(price) })),
            customer: { ...customer, cnic }, cash: Number(cash), bank: financed ? selectedBank : "", day: field(fields, "day") });
        });
      }}>
        <div className="wide table-scroll checkout-items"><table aria-label="Phones on this sale">
          <thead><tr><th scope="col">Phone</th><th scope="col">IMEI</th><th scope="col">Condition</th><th scope="col">Sale price (PKR)</th><th scope="col">Action</th></tr></thead>
          <tbody>{items.map(({ phone, price }) => {
            const model = getModel(phone);
            return <tr key={phone.id}>
              <td><strong>{title(model)}</strong><div className="checkout-item-specs">{[phone.color, model?.ram && "RAM: " + model.ram,
                ...Object.entries(model?.specs ?? {}).map(([name, value]) => name + ": " + value)].filter(Boolean).join(" · ")}</div></td>
              <td>{phone.imei}</td><td>{phone.condition}</td>
              <td><input type="number" required min="0" max="100000000" step="1" aria-label={"Sale price (PKR) for " + phone.imei} value={price}
                onChange={event => {
                  const value = event.target.value;
                  setItems(current => current.map(item => item.phone.id === phone.id ? { ...item, price: value } : item));
                  setCashCapped(false);
                }} onBlur={commitPrice} /></td>
              <td><Button aria-label={"Remove " + phone.imei} onClick={() => {
                const remaining = items.filter(item => item.phone.id !== phone.id);
                const nextTotal = remaining.reduce((sum, item) => sum + Number(item.price), 0);
                setItems(remaining);
                if (Number(cashInput) > nextTotal) {
                  setCashInput(String(nextTotal));
                  setCashCapped(true);
                }
              }}>Remove</Button></td>
            </tr>;
          })}</tbody>
          <tfoot><tr><th scope="row" colSpan={3}>Sale total</th><td className="checkout-total">{pkr(total)}</td><td /></tr></tfoot>
        </table></div>
        <CustomerPhonePicker customers={data.customers} value={customer.phone} onChange={applyCustomer}
          onSelect={value => { applyCustomer(value); customerName.current?.focus(); }} />
        <Field name="Customer name"><input ref={customerName} required autoComplete="off" value={customer.name} onChange={e => setCustomer({ ...customer, name: e.target.value })} /></Field>
        <Field name={financed ? "CNIC (required for financing)" : "CNIC (optional)"}>
          <input required={financed} inputMode="numeric" placeholder="13 digits" autoComplete="off" value={customer.cnic}
            onChange={e => setCustomer({ ...customer, cnic: e.target.value.replace(/\D/g, "").slice(0, 13) })} />
        </Field>
        <Field name="Address (optional)"><input autoComplete="off" value={customer.address} onChange={e => setCustomer({ ...customer, address: e.target.value })} /></Field>

        <Field name="Cash received (PKR)"><input required min="0" max={cashLimit} type="number" placeholder="0" value={cash}
          aria-describedby={cashCapped || priceLimitsCash ? "checkout-cash-limit" : undefined}
          onChange={e => updateCash(e.target.value)} /></Field>
        {(cashCapped || priceLimitsCash) && <p id="checkout-cash-limit" className="wide spec-strip" role="status">Cash is limited to the sale total of {pkr(cashLimit)}.</p>}
        <Field name="Finance company / bank"><select name="bank" required={financed} disabled={!financed}
          value={financed ? selectedBank : ""} onChange={e => setSelectedBank(e.target.value as BankId | "")}><option value="">{financed ? "Select a bank" : "Cash sale"}</option>{bankIds.map(id => <option key={id} value={id}>{settings[id].bank} · {settings[id].company}</option>)}</select></Field>
        <Field name="Bank amount"><input readOnly value={pkr(Math.max(0, amount))} /></Field>
        {financed && <p className="wide spec-strip">Bank payment status on save <Badge value="PENDING" /></p>}
        <Field name="Sale date"><input name="day" type="date" defaultValue={today()} required /></Field>
        <div className="wide actions"><Button className="primary" type="submit">Review sale</Button></div>
      </form>
    </section>}
    {review && <Modal title="Confirm sale" close={() => setReview(undefined)}>
      <div className="table-scroll checkout-items"><table aria-label="Sale review items">
        <thead><tr><th scope="col">Phone / IMEI</th><th scope="col">Price</th></tr></thead>
        <tbody>{items.map(({ phone, price }) => <tr key={phone.id}><td><strong>{title(getModel(phone))}</strong><div>{phone.imei}</div></td><td>{pkr(Number(price))}</td></tr>)}</tbody>
      </table></div>
      <p>{review.customer.name} · {review.customer.phone} · {showDate(review.day)}</p>
      <p>Total {pkr(review.items.reduce((sum, item) => sum + item.price, 0))}</p>
      <p>Cash paid {pkr(review.cash)}</p>
      {review.bank && <p>{settings[review.bank].bank} · {settings[review.bank].company} · {pkr(review.items.reduce((sum, item) => sum + item.price, 0) - review.cash)} <Badge value="PENDING" /></p>}
      <div className="actions"><Button onClick={() => setReview(undefined)}>Back</Button><Button data-dialog-focus className="primary" onClick={() => run(async () => {
        const sale = await sell(review);
        autofilledCustomer.current = false;
        setReview(undefined); setItems([]); setCashInput(""); setCashCapped(false); setSelectedBank("");
        setCustomer({ name: "", phone: "", cnic: "", address: "" });
        done(sale.sale_no + " saved."); receipt(sale);
      })}><Check size={16} /> Save &amp; generate receipt</Button></div>
    </Modal>}
  </div>;
}

export function Return({ data, run, done }: { data: Snapshot; run: Run; done: (msg: string) => void }) {
  const [sale, setSale] = useState<Sale>();
  const [review, setReview] = useState<Parameters<typeof returnPhone>[0]>();
  return <div className="stack">
    <PhoneSearch data={data} mode="SOLD" run={run} onSelect={p => {
      const current = data.sales.filter(s => saleIncludesPhone(s, p.id) && s.status === "COMPLETED").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      if (current) setSale(current);
      else void run(async () => { throw Error("No completed sale was found for this phone."); });
    }} />
    {!sale ? <section className="panel"><Empty>Scan a sold phone to view its original sale.</Empty></section> : <section className="panel" key={sale.id}>
      <div className="section-head"><div><h2>{sale.sale_no} · {saleItems(sale).map(item => item.phone_label).join(" + ")}</h2><p>{sale.customer_name} · {pkr(sale.total)}</p></div><Badge value={sale.bank_status} /></div>
      <form className="grid-form" onSubmit={e => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setReview({ saleId: sale.id, reason: field(f, "reason"), day: field(f, "day"), refund: Number(field(f, "refund")), adjustment: Number(field(f, "adjustment")), defective: field(f, "condition") === "DEFECTIVE", notes: field(f, "notes") });
      }}>
        {saleItems(sale).length > 1 && <p className="wide spec-strip">This return applies to all {saleItems(sale).length} phones on the receipt.</p>}
        <Field name="Return reason"><input name="reason" required /></Field>
        <Field name="Return date"><input name="day" required type="date" min={sale.sale_date} defaultValue={today()} /></Field>
        <Field name="Cash refund (PKR)"><input name="refund" type="number" min="0" max={sale.cash_amount} defaultValue={sale.cash_amount} required /></Field>
        <Field name="Bank adjustment (PKR)"><input name="adjustment" type="number" min="0" max={sale.bank_amount} defaultValue={sale.bank_status === "RECEIVED" ? sale.bank_amount : 0} disabled={sale.bank_status !== "RECEIVED"} required /></Field>
        <Field name="Phone disposition"><select name="condition"><option value="IN_STOCK">Return to stock</option><option value="DEFECTIVE">Defective</option></select></Field>
        <Field name="Refund notes" wide><textarea name="notes" /></Field>
        <div className="wide actions"><Button className="primary" type="submit">Review return</Button></div>
      </form>
    </section>}
    {sale && review && <Modal title="Confirm return" close={() => setReview(undefined)}>
      <p>{sale.sale_no} · {saleItems(sale).map(item => item.phone_label + " (" + item.imei + ")").join(" · ")}</p>
      {saleItems(sale).length > 1 && <p>This will return every phone on the receipt and close the sale.</p>}
      <p>Cash out {pkr(review.refund)} · Bank adjustment {pkr(review.adjustment)}</p>
      {sale.bank_status === "PENDING" && <p>The pending finance payment will be cancelled.</p>}
      <div className="actions"><Button onClick={() => setReview(undefined)}>Back</Button><Button data-dialog-focus className="primary" onClick={() => run(async () => {
        await returnPhone(review); setReview(undefined); setSale(undefined); done("Return recorded.");
      })}>Save return</Button></div>
    </Modal>}
  </div>;
}

export function keyboardSave(e: KeyboardEvent<HTMLFormElement>) {
  if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); e.currentTarget.requestSubmit(); }
}
