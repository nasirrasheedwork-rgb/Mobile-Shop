"use client";

import { useState } from "react";
import { ArrowUpRight, Banknote, BarChart3, Boxes, Building2, Clock3, Plus, ShoppingBag, Wallet } from "lucide-react";
import { bankTotals, pkr, shiftDay, showDate, signed, today } from "@/lib/format";
import { bankIds, saleItems, type Sale, type Settings, type Snapshot } from "@/lib/schema";
import { Badge, Button, Empty, Period, Stat } from "./ui";

export function BankStat({ name, entries }: { name: string; entries: Snapshot["ledger_entries"] }) {
  const { received, pending, total } = bankTotals(entries);
  return <Stat label={name} amount={total} icon={<Building2 size={19} />}>
    <div className="split"><span>Received <b>{pkr(received)}</b></span><span>Pending <b>{pkr(pending)}</b></span></div>
  </Stat>;
}

export function Dashboard({ data, settings, go, receipt }: {
  data: Snapshot; settings: Settings; go: (page: string) => void; receipt: (sale: Sale) => void;
}) {
  const [range, setRange] = useState("Today");
  const day = today();
  const [custom, setCustom] = useState([day, day]);
  const weekday = (new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7;
  const start = range === "This week" ? shiftDay(day, -weekday) : range === "This month" ? day.slice(0, 7) + "-01" : range === "Custom" ? custom[0] : day;
  const end = range === "Custom" ? custom[1] : day;
  const sales = data.sales.filter(s => s.status === "COMPLETED");
  const period = sales.filter(s => (!start || s.sale_date >= start) && (!end || s.sale_date <= end));
  const recent = [...data.sales].sort((a, b) => b.sale_date.localeCompare(a.sale_date) || b.created_at.localeCompare(a.created_at)).slice(0, 10);
  const pending = sales.filter(s => s.bank_status === "PENDING").sort((a, b) => a.sale_date.localeCompare(b.sale_date) || a.created_at.localeCompare(b.created_at));
  const stock = data.phones.filter(p => p.status === "IN_STOCK");
  const cash = data.ledger_entries.filter(e => e.account === "CASH");
  const sum = (key: "total" | "profit" | "cash_amount" | "bank_amount") => period.reduce((v, row) => v + row[key], 0);
  const chart = Array.from({ length: 30 }, (_, i) => {
    const date = shiftDay(day, i - 29);
    return { date, total: sales.filter(s => s.sale_date === date).reduce((value, s) => value + s.total, 0) };
  });
  const max = Math.max(1, ...chart.map(c => c.total));
  return <div className="stack">
    <section className="overview">
      <div><span className="overview-date"><Clock3 size={15} /> {showDate(day)}</span><h2>Business overview</h2><p>Track stock, daily sales and finance payments.</p></div>
      <div className="hero-actions"><Button onClick={() => go("purchase")}><Plus size={17} /> Stock in</Button><Button className="primary" onClick={() => go("sell")}><ShoppingBag size={17} /> New sale</Button></div>
    </section>
    <div className="stats four">
      <Stat label="Cash in hand" amount={cash.reduce((v, e) => v + signed(e), 0)} icon={<Wallet size={19} />}><span>Cash sales less refunds</span></Stat>
      {bankIds.map(id => <BankStat key={id} name={settings[id].bank} entries={data.ledger_entries.filter(e => e.account === id)} />)}
      <BankStat name="Both banks" entries={data.ledger_entries.filter(e => e.account !== "CASH")} />
    </div>
    <div className="summary-head"><h2>Trading summary</h2><div className="range-select" aria-label="Dashboard date range">{["Today", "This week", "This month", "Custom"].map(value => <button key={value} className={range === value ? "selected" : ""} onClick={() => setRange(value)}>{value}</button>)}</div></div>
    {range === "Custom" && <Period start={custom[0]} end={custom[1]} onChange={(from, to) => setCustom([from, to])} />}
    <div className="stats three">
      <Stat label={range === "Today" ? "Today's sales" : "Sales in period"} amount={sum("total")} icon={<ShoppingBag size={19} />}><span>{period.length} sales · Cash {pkr(sum("cash_amount"))} · Bank {pkr(sum("bank_amount"))}</span></Stat>
      <Stat label={range === "Today" ? "Today's profit" : "Profit in period"} amount={sum("profit")} icon={<BarChart3 size={19} />}>Completed sales</Stat>
      <Stat label="Stock value" amount={stock.reduce((value, p) => value + p.cost_price, 0)} icon={<Boxes size={19} />}>{stock.length} phones in stock</Stat>
    </div>
    <div className="dashboard-columns">
      <section className="panel chart-panel">
        <div className="section-head"><div><h2>Sales activity</h2><p>Completed sales over the last 30 days</p></div><BarChart3 size={20} /></div>
        <div className="chart" role="img" aria-label={"30-day sales chart. Highest day " + pkr(max === 1 && !chart.some(c => c.total) ? 0 : max)}>
          {chart.map(c => <div key={c.date} className="chart-slot" title={showDate(c.date) + " · " + pkr(c.total)}><span style={{ height: Math.max(2, c.total / max * 100) + "%" }} data-empty={!c.total} /></div>)}
        </div>
        <div className="chart-axis"><span>{showDate(chart[0].date)}</span><span>{showDate(day)}</span></div>
      </section>
      <section className="panel pending-panel">
        <div className="section-head"><div><h2>Pending from companies</h2><p>Oldest payments first</p></div><Banknote size={20} /></div>
        {!pending.length ? <Empty>No pending finance payments.</Empty> : <ul className="list">{pending.map(s => <li key={s.id}><button className="text-link" onClick={() => go(s.bank_id === "BANK_A" ? "bank-a" : "bank-b")}>{s.sale_no}<small>{s.bank_id && settings[s.bank_id].company} · {showDate(s.sale_date)}</small></button><strong>{pkr(s.bank_amount)}</strong></li>)}</ul>}
      </section>
    </div>
    <section className="panel data-panel">
      <div className="section-head padded"><div><h2>Recent sales</h2><p>Last 10 transactions</p></div><Button onClick={() => go("sales")}>View sales <ArrowUpRight size={16} /></Button></div>
      {recent.length ? <div className="table-scroll"><table><thead><tr>{["Sale #", "Customer", "Phone", "Date", "Total", "Status"].map(value => <th key={value}>{value}</th>)}</tr></thead><tbody>{recent.map(s => <tr key={s.id}><td><button className="text-link" onClick={() => receipt(s)}>{s.sale_no}</button></td><td>{s.customer_name}</td><td>{saleItems(s).map(item => item.phone_label).join(" + ")}</td><td>{showDate(s.sale_date)}</td><td>{pkr(s.total)}</td><td><Badge value={s.status === "RETURNED" ? s.status : s.bank_status ?? s.status} /></td></tr>)}</tbody></table></div> : <Empty>No sales yet.</Empty>}
    </section>
  </div>;
}
