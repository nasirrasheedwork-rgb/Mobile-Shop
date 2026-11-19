"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Download, Search } from "lucide-react";
import { csv, excel, type Cell } from "@/lib/download";
import { bankTotals, label, matches, pkr, showDate, signed, title, today } from "@/lib/format";
import { saleIncludesPhone, saleItems, type BankId, type Entry, type Phone, type Sale, type Settings, type Snapshot } from "@/lib/schema";
import { confirmBank } from "@/lib/transactions";
import { Badge, Button, Empty, Field, Modal, Period, Stat, type Run } from "./ui";

export type Column<T> = { name: string; value: (row: T) => Cell; render?: (row: T) => ReactNode; sort?: (row: T) => Cell };
export type Filter<T> = { name: string; options: { value: string; label: string }[]; value: (row: T) => string };
export const column = <T,>(name: string, value: (row: T) => Cell, render?: (row: T) => ReactNode, sort?: (row: T) => Cell): Column<T> => ({ name, value, render, sort });
const currency = <T,>(name: string, value: (row: T) => number) => column(name, value, row => pkr(value(row)));
const dated = <T,>(name: string, value: (row: T) => string | null | undefined) => column<T>(name, row => showDate(value(row)), undefined, row => value(row) ?? "");
const status = <T,>(name: string, value: (row: T) => string | null) => column<T>(name, row => label(value(row)), row => <Badge value={value(row)} />);
const options = (values: string[]) => [...new Set(values)].sort().map(value => ({ value, label: value }));
const statusOptions = (values: string[]) => values.map(value => ({ value, label: label(value) }));
const localDate = (day: string, start: string, end: string) => (!start || day >= start) && (!end || day <= end);

export function Table<T extends { id: string }>({ name, rows, columns, filters = [], day, select, action, toolbar, run }: {
  name: string; rows: T[]; columns: Column<NoInfer<T>>[]; filters?: Filter<T>[]; day?: (row: T) => string;
  select?: (row: T) => ReactNode; action?: (row: T) => ReactNode; toolbar?: ReactNode; run: Run;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<Record<string, string>>({});
  const [period, setPeriod] = useState(["", ""]);
  const [sorting, setSorting] = useState<{ index: number; desc: boolean }>();
  const [page, setPage] = useState(0);
  const filtered = rows.filter(row => matches(query, ...columns.map(c => String(c.value(row))))
    && filters.every(f => !active[f.name] || f.value(row) === active[f.name])
    && (!day || localDate(day(row), period[0], period[1])));
  if (sorting) {
    const c = columns[sorting.index];
    const value = c.sort ?? c.value;
    filtered.sort((a, b) => {
      const first = value(a);
      const second = value(b);
      const cmp = typeof first === "number" && typeof second === "number" ? first - second : String(first).localeCompare(String(second), undefined, { numeric: true });
      return sorting.desc ? -cmp : cmp;
    });
  }
  const pages = Math.max(1, Math.ceil(filtered.length / 12));
  const index = Math.min(page, pages - 1);
  const output = () => [columns.map(c => c.name), ...filtered.map(row => columns.map(c => c.value(row)))];

  return <section className="panel data-panel">
    <div className="table-tools">
      <label className="table-search"><Search size={17} /><input aria-label={"Search " + name} placeholder={"Search " + name.toLowerCase() + "…"} value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
      {filters.map(f => <select key={f.name} aria-label={f.name} value={active[f.name] ?? ""} onChange={e => { setActive({ ...active, [f.name]: e.target.value }); setPage(0); }}><option value="">{f.name}</option>{f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>)}
      {day && <Period start={period[0]} end={period[1]} onChange={(start, end) => { setPeriod([start, end]); setPage(0); }} />}
      <div className="table-export"><Button onClick={() => csv(name, output())}><Download size={15} /> CSV</Button><Button onClick={() => run(() => excel(name, output()))}>Excel</Button></div>
    </div>
    {toolbar}
    <div className="table-scroll">
      <table><thead><tr>{select && <th scope="col">Select</th>}{columns.map((c, i) => <th key={c.name} scope="col" aria-sort={sorting?.index === i ? sorting.desc ? "descending" : "ascending" : "none"}><button onClick={() => setSorting({ index: i, desc: sorting?.index === i ? !sorting.desc : false })}>{c.name}{sorting?.index === i && (sorting.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}</button></th>)}{action && <th scope="col">Action</th>}</tr></thead>
        <tbody>{filtered.slice(index * 12, index * 12 + 12).map(row => <tr key={row.id}>{select && <td>{select(row)}</td>}{columns.map(c => <td key={c.name}>{c.render ? c.render(row) : c.value(row)}</td>)}{action && <td>{action(row)}</td>}</tr>)}</tbody>
      </table>
      {!filtered.length && <Empty />}
    </div>
    <div className="pagination"><span>{filtered.length} {filtered.length === 1 ? "record" : "records"}</span><div><Button disabled={index === 0} onClick={() => setPage(index - 1)}>Previous</Button><span>{index + 1} / {pages}</span><Button disabled={index + 1 >= pages} onClick={() => setPage(index + 1)}>Next</Button></div></div>
  </section>;
}

export function Sales({ data, rows = data.sales, settings, run, receipt }: {
  data: Snapshot; rows?: Sale[]; settings: Settings; run: Run; receipt: (sale: Sale) => void;
}) {
  return <Table name="Sales" rows={[...rows].sort((a, b) => b.sale_no.localeCompare(a.sale_no, undefined, { numeric: true }))} run={run} day={s => s.sale_date}
    columns={[
      column<Sale>("Sale #", (s: Sale) => s.sale_no), dated<Sale>("Date", s => s.sale_date), column<Sale>("Customer", s => s.customer_name),
      column<Sale>("Phones", s => saleItems(s).map(item => item.phone_label).join(" + ")), column<Sale>("IMEIs", s => saleItems(s).map(item => item.imei).join(", ")), currency<Sale>("Total", s => s.total), currency<Sale>("Cash paid", s => s.cash_amount),
      column<Sale>("Bank", s => s.bank_id ? settings[s.bank_id].bank : "—"), currency<Sale>("Bank amount", s => s.bank_amount),
      status<Sale>("Bank status", s => s.bank_status ?? "CASH_ONLY"), status<Sale>("Sale status", s => s.status), currency<Sale>("Profit", s => s.profit),
    ]}
    filters={[
      { name: "Bank", options: [{ value: "BANK_A", label: settings.BANK_A.bank }, { value: "BANK_B", label: settings.BANK_B.bank }, { value: "cash", label: "Cash sale" }], value: s => s.bank_id ?? "cash" },
      { name: "Bank status", options: statusOptions(["PENDING", "RECEIVED", "CANCELLED", "CASH_ONLY"]), value: s => s.bank_status ?? "CASH_ONLY" },
      { name: "Sale status", options: statusOptions(["COMPLETED", "RETURNED"]), value: s => s.status },
      { name: "Customer", options: data.customers.map(c => ({ value: c.id, label: c.name + " · " + c.phone })), value: s => s.customer_id },
    ]} action={s => <Button onClick={() => receipt(s)}>Receipt</Button>} />;
}

export function Inventory({ data, run }: { data: Snapshot; run: Run }) {
  const [detail, setDetail] = useState<Phone>();
  const models = new Map(data.models.map(m => [m.id, m]));
  const stock = data.phones.filter(p => p.status === "IN_STOCK");
  const count = new Map<string, number>();
  for (const p of stock) count.set(p.model_id, (count.get(p.model_id) ?? 0) + 1);
  const history = detail ? [
    ...data.purchases.filter(p => p.phone_id === detail.id).map(p => ({ id: p.id, day: p.purchase_date, label: "Purchased · " + p.supplier + " · " + pkr(p.cost_price), time: p.created_at })),
    ...data.sales.filter(s => saleIncludesPhone(s, detail.id)).map(s => ({ id: s.id, day: s.sale_date, label: "Sold · " + s.sale_no + " · " + s.customer_name, time: s.created_at })),
    ...data.returns.filter(r => r.phone_id === detail.id || data.sales.some(s => s.id === r.sale_id && saleIncludesPhone(s, detail.id))).map(r => ({ id: r.id, day: r.return_date, label: "Returned · " + r.reason + " · " + label(r.disposition), time: r.created_at })),
  ].sort((a, b) => a.day.localeCompare(b.day) || a.time.localeCompare(b.time)) : [];

  return <div className="stack">
    <div className="stats three">
      <article className="stat"><span>Phones in stock</span><strong>{stock.length}</strong></article>
      <Stat label="Stock cost" amount={stock.reduce((sum, p) => sum + p.cost_price, 0)} />
      <Stat label="Expected sale value" amount={stock.reduce((sum, p) => sum + p.sale_price, 0)} />
    </div>
    {count.size > 0 && <section className="panel"><h2>Stock by model</h2><div className="chips">{[...count].map(([id, total]) => <span className="chip" key={id}>{title(models.get(id))} · {total} in stock</span>)}</div></section>}
    <Table name="Inventory" run={run} rows={data.phones} day={p => p.purchase_date}
      columns={[
        column<Phone>("IMEI", (p: Phone) => p.imei, p => <button className="text-link" onClick={() => setDetail(p)}>{p.imei}</button>),
        column<Phone>("Brand", p => models.get(p.model_id)?.brand ?? "—"), column<Phone>("Model", p => models.get(p.model_id)?.model ?? "—"),
        column<Phone>("Storage / RAM", p => [models.get(p.model_id)?.storage, models.get(p.model_id)?.ram].filter(Boolean).join(" / ")),
        column<Phone>("Color", p => p.color), column<Phone>("Condition", p => p.condition), currency<Phone>("Cost", p => p.cost_price), currency<Phone>("Sale price", p => p.sale_price), status<Phone>("Status", p => p.status), dated<Phone>("Purchased", p => p.purchase_date),
      ]}
      filters={[
        { name: "Status", options: statusOptions(["IN_STOCK", "SOLD", "RETURNED", "DEFECTIVE"]), value: p => p.status },
        { name: "Brand", options: options(data.models.map(m => m.brand)), value: p => models.get(p.model_id)?.brand ?? "" },
        { name: "Model", options: data.models.map(m => ({ value: m.id, label: title(m) })), value: p => p.model_id },
        { name: "Condition", options: options(["New", "Used"]), value: p => p.condition },
      ]} />
    {detail && <Modal title={title(models.get(detail.model_id))} close={() => setDetail(undefined)}>
      <p>{detail.imei} · {detail.color} · {detail.condition}</p>
      <div className="timeline">{history.map(item => <div key={item.id}><b>{showDate(item.day)}</b><span>{item.label}</span></div>)}</div>
    </Modal>}
  </div>;
}

export function Customers({ data, settings, run, receipt }: Parameters<typeof Sales>[0]) {
  const [selected, setSelected] = useState("");
  const customer = data.customers.find(c => c.id === selected);
  const stats = useMemo(() => {
    const map = new Map<string, { count: number; amount: number; last: string }>();
    for (const sale of data.sales) {
      const previous = map.get(sale.customer_id) ?? { count: 0, amount: 0, last: "" };
      if (sale.status === "COMPLETED") { previous.count++; previous.amount += sale.total; }
      if (sale.sale_date > previous.last) previous.last = sale.sale_date;
      map.set(sale.customer_id, previous);
    }
    return map;
  }, [data.sales]);

  if (customer) return <div className="stack">
    <section className="panel"><div className="section-head"><div><h2>{customer.name}</h2><p>{[customer.phone, customer.cnic, customer.address].filter(Boolean).join(" · ")}</p></div><Button onClick={() => setSelected("")}>All customers</Button></div></section>
    <Sales data={data} settings={settings} rows={data.sales.filter(s => s.customer_id === customer.id)} run={run} receipt={receipt} />
  </div>;
  return <Table name="Customers" rows={data.customers} run={run} day={c => stats.get(c.id)?.last ?? ""}
    filters={[{ name: "Purchase history", options: options(["Has active purchases", "No active purchases"]), value: c => stats.get(c.id)?.count ? "Has active purchases" : "No active purchases" }]}
    columns={[
      column<Snapshot["customers"][number]>("Name", c => c.name, c => <button className="text-link" onClick={() => setSelected(c.id)}>{c.name}</button>),
      column<Snapshot["customers"][number]>("Phone", c => c.phone), column<Snapshot["customers"][number]>("CNIC", c => c.cnic), column<Snapshot["customers"][number]>("Total purchases", c => stats.get(c.id)?.count ?? 0),
      currency<Snapshot["customers"][number]>("Total amount", c => stats.get(c.id)?.amount ?? 0), dated<Snapshot["customers"][number]>("Last purchase", c => stats.get(c.id)?.last),
    ]} />;
}

export function Purchases({ data, run }: { data: Snapshot; run: Run }) {
  return <Table name="Purchases" run={run} rows={[...data.purchases].sort((a, b) => b.purchase_date.localeCompare(a.purchase_date))} day={p => p.purchase_date}
    filters={[{ name: "Supplier", options: options(data.purchases.map(p => p.supplier)), value: p => p.supplier }, { name: "Model", options: options(data.purchases.map(p => p.label)), value: p => p.label }]}
    columns={[dated<Snapshot["purchases"][number]>("Date", p => p.purchase_date), column<Snapshot["purchases"][number]>("Supplier", p => p.supplier), column<Snapshot["purchases"][number]>("Model", p => p.label), column<Snapshot["purchases"][number]>("IMEI", p => p.imei), currency<Snapshot["purchases"][number]>("Cost price", p => p.cost_price)]} />;
}

export function Ledger({ account, data, run, done }: { account: BankId | "CASH"; data: Snapshot; run: Run; done: (message: string) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [review, setReview] = useState<{ ids: string[]; receive: boolean }>();
  const sales = new Map(data.sales.map(s => [s.id, s]));
  const ordered = data.ledger_entries.filter(e => e.account === account).sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));
  let running = 0;
  const rows = ordered.map(e => ({ ...e, balance: running += signed(e) })).reverse();
  const total = bankTotals(rows);
  const cash = account === "CASH";
  const pending = selected.filter(id => sales.get(id)?.bank_status === "PENDING");
  function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!review || account === "CASH") return;
    const f = new FormData(e.currentTarget);
    void run(async () => {
      await confirmBank(review.ids, account, review.receive, String(f.get("date") || today()), String(f.get("ref") ?? "").trim());
      done(review.receive ? "Bank payments marked as received." : "Bank payment moved back to pending.");
      setSelected([]); setReview(undefined);
    });
  }

  const base = [dated("Date", (row: Entry) => row.date), column<Entry>("Sale #", row => sales.get(row.sale_id)?.sale_no ?? "—"), column<Entry>("Customer", row => sales.get(row.sale_id)?.customer_name ?? "—")];
  return <div className="stack">
    <div className="stats three">{cash ? <>
      <Stat label="Cash in" amount={rows.filter(e => e.type === "IN").reduce((sum, e) => sum + e.amount, 0)}>Cash collected from customers</Stat>
      <Stat label="Cash out" amount={rows.filter(e => e.type !== "IN").reduce((sum, e) => sum + e.amount, 0)}>Cash refunds to customers</Stat>
      <Stat label="Cash in hand" amount={running}>Cash collected minus cash refunds</Stat>
    </> : <><Stat label="Received" amount={total.received} /><Stat label="Pending" amount={total.pending} /><Stat label="Total" amount={total.total} /></>}</div>
    <Table name={cash ? "Cash ledger" : account === "BANK_A" ? "Bank A ledger" : "Bank B ledger"} rows={rows} day={row => row.date} run={run}
      columns={cash ? [...base, currency<Entry>("Cash in", e => e.type === "IN" ? e.amount : 0), currency<Entry>("Cash out", e => e.type === "OUT" ? e.amount : 0), currency<Entry & { balance: number }>("Running balance", e => e.balance)] :
        [...base, currency<Entry>("Amount", signed), status<Entry>("Status", e => e.status), dated<Entry>("Received date", e => e.received_date), column<Entry>("Reference #", e => e.reference_no), column<Entry>("Entry", e => label(e.type))]}
      filters={cash ? [{ name: "Type", options: statusOptions(["IN", "OUT"]), value: e => e.type }] : [{ name: "Status", options: statusOptions(["PENDING", "RECEIVED", "CANCELLED"]), value: e => e.status }]}
      select={cash ? undefined : e => e.status === "PENDING" && <input type="checkbox" aria-label={"Select " + sales.get(e.sale_id)?.sale_no} checked={pending.includes(e.sale_id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, e.sale_id] : ids.filter(id => id !== e.sale_id))} />}
      action={cash ? undefined : e => {
        const sale = sales.get(e.sale_id);
        if (e.type !== "IN" || sale?.status !== "COMPLETED") return null;
        if (e.status === "PENDING") {
          return <Button aria-label={"Mark " + sale.sale_no + " as received"} onClick={() => setReview({ ids: [e.sale_id], receive: true })}>Mark as received</Button>;
        }
        return e.status === "RECEIVED" && <Button onClick={() => setReview({ ids: [e.sale_id], receive: false })}>Undo</Button>;
      }}
      toolbar={!cash && <div className="bulk"><Button className="primary" disabled={!pending.length} onClick={() => setReview({ ids: pending, receive: true })}>Mark as received {pending.length > 0 && "(" + pending.length + ")"}</Button></div>} />
    {review && <Modal title={review.receive ? "Confirm bank receipt" : "Undo bank receipt"} close={() => setReview(undefined)}>
      <form onSubmit={confirm} className="grid-form">
        <p className="wide">{review.receive ? "Confirm " + pkr(review.ids.reduce((sum, id) => sum + (sales.get(id)?.bank_amount ?? 0), 0)) + " for " + (review.ids.length === 1 ? sales.get(review.ids[0])?.sale_no : review.ids.length + " selected sales") + "." : "Move this bank payment back to pending?"}</p>
        {review.receive && <><Field name="Received date"><input required type="date" name="date" defaultValue={today()} /></Field><Field name="Reference number"><input name="ref" /></Field></>}
        <div className="wide actions"><Button onClick={() => setReview(undefined)}>Back</Button><Button data-dialog-focus className="primary" type="submit">Confirm</Button></div>
      </form>
    </Modal>}
  </div>;
}
