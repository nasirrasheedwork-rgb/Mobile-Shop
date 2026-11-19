"use client";

import { useRef, useState } from "react";
import { CloudUpload, DatabaseBackup, Download, Plus, Printer } from "lucide-react";
import { exportBackup, importBackup } from "@/lib/backup";
import { atomic, audit, db, demoMode, put, setPin } from "@/lib/db";
import { csv, excel, type Cell } from "@/lib/download";
import { bankTotals, pkr, showDate, signed, title, today } from "@/lib/format";
import { bankIds, saleItems, type Model, type Settings, type Snapshot } from "@/lib/schema";
import { type Run, Button, Field, Modal, Period, field } from "./ui";
import { ModelForm } from "./workflows";
import { Purchases, Table, column } from "./tables";

export function Restore({ run, onRestored }: { run: Run; onRestored: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  return <>
    <input ref={input} hidden aria-label="Choose backup" type="file" accept=".json,application/json" onChange={e => { setFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
    <Button onClick={() => input.current?.click()}>Import backup</Button>
    {file && <Modal title="Restore backup" close={() => setFile(undefined)}>
      <p>Restore {file.name}? This replaces all records on this device. You’ll unlock with the PIN saved in the backup.</p>
      <div className="actions"><Button onClick={() => setFile(undefined)}>Cancel</Button><Button className="danger" onClick={() => run(async () => { await importBackup(file); setFile(undefined); onRestored(); })}>Replace data</Button></div>
    </Modal>}
  </>;
}

const reportTypes = ["Daily closing", "Sales", "Profit", "Stock", "Bank-wise"] as const;
function Reports({ data, settings, run }: { data: Snapshot; settings: Settings; run: Run }) {
  const [report, setReport] = useState<typeof reportTypes[number]>("Daily closing");
  const [period, setPeriod] = useState([today(), today()]);
  const [start, end] = period;
  const inside = (day: string) => day >= start && day <= end;
  const sales = data.sales.filter(s => s.status === "COMPLETED" && inside(s.sale_date)).sort((a, b) => a.sale_date.localeCompare(b.sale_date));
  const cash = data.ledger_entries.filter(e => e.account === "CASH");
  const opening = cash.filter(e => e.date < start).reduce((v, e) => v + signed(e), 0);
  const cashIn = cash.filter(e => e.type === "IN" && inside(e.date)).reduce((v, e) => v + e.amount, 0);
  const cashOut = cash.filter(e => e.type !== "IN" && inside(e.date)).reduce((v, e) => v + e.amount, 0);
  const bankRows = bankIds.map(id => ({
    id, ...bankTotals(data.ledger_entries.filter(e => e.account === id && (e.status === "RECEIVED" ? inside(e.received_date ?? e.date) : e.date <= end))),
  }));
  let rows: Cell[][];
  switch (report) {
    case "Daily closing":
      rows = [["Metric", "PKR"], ["Opening cash", opening], ["Cash in", cashIn], ["Cash out", cashOut], ["Closing cash", opening + cashIn - cashOut],
        ...bankRows.flatMap(b => [[settings[b.id].bank + " received in period", b.received], [settings[b.id].bank + " currently pending through end date", b.pending]])];
      break;
    case "Sales":
      rows = [["Sale #", "Date", "Customer", "Phone", "Total", "Cash", "Bank"], ...sales.map(s => [s.sale_no, showDate(s.sale_date), s.customer_name, saleItems(s).map(item => item.phone_label).join(" + "), s.total, s.cash_amount, s.bank_amount]),
        ["Total", "", "", "", sales.reduce((n, s) => n + s.total, 0), sales.reduce((n, s) => n + s.cash_amount, 0), sales.reduce((n, s) => n + s.bank_amount, 0)]];
      break;
    case "Profit":
      rows = [["Sale #", "Date", "Phone", "Revenue", "Cost", "Profit"], ...sales.map(s => [s.sale_no, showDate(s.sale_date), saleItems(s).map(item => item.phone_label).join(" + "), s.total, s.total - s.profit, s.profit]),
        ["Total", "", "", sales.reduce((n, s) => n + s.total, 0), sales.reduce((n, s) => n + s.total - s.profit, 0), sales.reduce((n, s) => n + s.profit, 0)]];
      break;
    case "Stock":
      rows = [["IMEI", "Model", "Condition", "Cost", "Expected sale"], ...data.phones.filter(p => p.status === "IN_STOCK").map(p => [p.imei, title(data.models.find(m => m.id === p.model_id)), p.condition, p.cost_price, p.sale_price])];
      break;
    case "Bank-wise":
      rows = [["Bank", "Company", "Received in period", "Currently pending through end date", "Total"], ...bankRows.map(b => [settings[b.id].bank, settings[b.id].company, b.received, b.pending, b.total])];
      break;
  }
  const valid = report === "Stock" || (!!start && !!end && start <= end);
  return <section className="panel stack">
    <div className="table-tools plain screen-only">
      <select aria-label="Report type" value={report} onChange={e => setReport(e.target.value as typeof report)}>{reportTypes.map(r => <option key={r}>{r}</option>)}</select>
      {report !== "Stock" && <Period start={start} end={end} onChange={(from, to) => setPeriod([from, to])} />}
      <div className="table-export">
        <Button disabled={!valid} onClick={() => csv(report, rows)}><Download size={15} /> CSV</Button>
        <Button disabled={!valid} onClick={() => run(() => excel(report, rows))}>Excel</Button>
        <Button disabled={!valid} onClick={() => window.print()}><Printer size={15} /> Print</Button>
      </div>
    </div>
    <article className="print-target report">
      <div className="section-head"><div><h2>{report} report</h2><p>{settings.shop} · {report === "Stock" ? showDate(today()) : showDate(start) + " to " + showDate(end)}</p></div></div>
      <div className="table-scroll"><table><thead><tr>{rows[0].map((value, index) => <th key={index}>{value}</th>)}</tr></thead><tbody>
        {valid && rows.slice(1).map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{typeof value === "number" ? pkr(value) : value}</td>)}</tr>)}
      </tbody></table></div>
    </article>
  </section>;
}

export function Command({ data, settings, run, done, onRestored, status, syncNow }: {
  data: Snapshot; settings: Settings; run: Run; done: (message: string) => void; onRestored: () => void;
  status: { backup: string; syncedAt: string; unsynced: number; configured: boolean }; syncNow: () => void;
}) {
  const [tab, setTab] = useState("Reports");
  const [editModel, setEditModel] = useState<Model | "new">();
  const overdue = !status.backup || Date.now() - Date.parse(status.backup) >= 86400000;
  return <div className="stack">
    <div className="command-tabs">{["Reports", "Transactions", "Purchases", "Model catalog", "Settings", ...(demoMode ? [] : ["Sync"])].map(t => <Button key={t} className={tab === t ? "primary" : ""} onClick={() => setTab(t)}>{t}</Button>)}</div>
    {tab === "Reports" && <Reports data={data} settings={settings} run={run} />}
    {tab === "Transactions" && <Table name="Transactions" rows={[...data.audit_log].sort((a, b) => b.timestamp.localeCompare(a.timestamp))} run={run}
      day={row => today(new Date(row.timestamp))}
      filters={[{ name: "Action", options: [...new Set(data.audit_log.map(row => row.action))].sort().map(value => ({ value, label: value })), value: row => row.action }]}
      columns={[
        column<Snapshot["audit_log"][number]>("Timestamp (PKT)", row => showDate(today(new Date(row.timestamp))) + " " + new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Karachi", timeStyle: "medium" }).format(new Date(row.timestamp)), undefined, row => row.timestamp),
        column<Snapshot["audit_log"][number]>("Action", row => row.action), column<Snapshot["audit_log"][number]>("Entity", row => row.entity), column<Snapshot["audit_log"][number]>("Details", row => Object.entries(row.data).map(([key, value]) => key + ": " + (value ?? "—")).join(" · ")),
      ]} />}
    {tab === "Purchases" && <Purchases data={data} run={run} />}
    {tab === "Model catalog" && <>
      <div className="summary-head"><h2>Model catalog</h2><Button className="primary" onClick={() => setEditModel("new")}><Plus size={17} /> Add model</Button></div>
      <Table name="Model catalog" rows={data.models} run={run} action={m => <Button onClick={() => setEditModel(m)}>Edit</Button>}
        filters={[{ name: "Brand", options: [...new Set(data.models.map(m => m.brand))].sort().map(value => ({ value, label: value })), value: m => m.brand }]}
        columns={[column<Model>("Brand", m => m.brand), column<Model>("Model", m => m.model), column<Model>("Storage", m => m.storage), column<Model>("RAM", m => m.ram), column<Model>("Color", m => m.color), column<Model>("TAC", m => m.tac_codes.join(", ")), column<Model>("Default cost", m => m.default_cost, m => pkr(m.default_cost)), column<Model>("Default price", m => m.default_price, m => pkr(m.default_price))]} />
      {editModel && <Modal title={editModel === "new" ? "Add new model" : "Edit model"} close={() => setEditModel(undefined)}><ModelForm existing={editModel === "new" ? undefined : editModel} run={run} onSave={() => { setEditModel(undefined); done("Model saved."); }} /></Modal>}
    </>}
    {tab === "Settings" && <>
      <section className="panel">
        <div className="section-head"><div><h2>Shop settings</h2><p>Receipt details, finance accounts and automatic lock</p></div></div>
        <form className="grid-form" onSubmit={e => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void run(async () => {
            await atomic(async () => {
              const current = await db.records("settings").get(settings.id);
              if (!current) throw Error("Owner settings changed.");
              const finance = (key: string) => ({ company: field(f, key + "-company"), bank: field(f, key + "-bank"), title: field(f, key + "-title"), number: field(f, key + "-number") });
              await put("settings", { ...current, shop: field(f, "shop"), phone: field(f, "phone"), address: field(f, "address"), lock_minutes: Number(field(f, "lock")), BANK_A: finance("BANK_A"), BANK_B: finance("BANK_B") }, current);
              await audit("Shop settings updated", "settings", current.id);
            });
            done("Settings saved.");
          });
        }}>
          <Field name="Shop name"><input name="shop" required defaultValue={settings.shop} /></Field>
          <Field name="Shop phone"><input name="phone" type="tel" defaultValue={settings.phone} /></Field>
          <Field name="Shop address"><input name="address" defaultValue={settings.address} /></Field>
          <Field name="Auto-lock after (minutes)"><input name="lock" type="number" min="1" max="1440" required defaultValue={settings.lock_minutes} /></Field>
          {bankIds.map(id => <fieldset key={id} className="wide finance-settings"><legend>{id === "BANK_A" ? "Finance account A" : "Finance account B"}</legend>
            <div className="grid-form"><Field name="Company name"><input name={id + "-company"} required defaultValue={settings[id].company} /></Field>
            <Field name="Bank name"><input name={id + "-bank"} required defaultValue={settings[id].bank} /></Field>
            <Field name="Account title"><input name={id + "-title"} defaultValue={settings[id].title} /></Field>
            <Field name="Account number"><input name={id + "-number"} defaultValue={settings[id].number} /></Field></div>
          </fieldset>)}
          <div className="actions wide"><Button className="primary" type="submit">Save settings</Button></div>
        </form>
      </section>
      <section className="panel"><h2>Owner PIN</h2><form className="grid-form" onSubmit={e => {
        e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
        void run(async () => {
          if (f.get("new") !== f.get("repeat")) throw Error("The new PIN entries do not match.");
          await setPin(String(f.get("new")), String(f.get("current"))); form.reset(); done("Owner PIN updated.");
        });
      }}>
        <Field name="Current PIN"><input name="current" required type="password" autoComplete="current-password" /></Field>
        <Field name="New PIN"><input name="new" required minLength={4} type="password" autoComplete="new-password" /></Field>
        <Field name="Confirm new PIN"><input name="repeat" required minLength={4} type="password" autoComplete="new-password" /></Field>
        <div className="wide actions"><Button type="submit">Change PIN</Button></div>
      </form></section>
      <section className="panel"><div className="section-head"><div><h2>Backup and restore</h2><p>{status.backup ? "Last backup " + showDate(today(new Date(status.backup))) : "No backup recorded"}</p></div><DatabaseBackup size={22} /></div>
        {overdue && <p className="notice">It’s time to export a backup. Keep the JSON file somewhere private.</p>}
        <div className="actions"><Restore run={run} onRestored={onRestored} /><Button className="primary" onClick={() => run(async () => { await exportBackup(); done("Backup exported."); })}><Download size={16} /> Export backup</Button></div>
      </section>
    </>}
    {tab === "Sync" && <section className="panel">
      <div className="section-head"><div><h2>Cloud sync</h2><p>{status.unsynced} records waiting · {status.syncedAt ? "Last sync " + new Date(status.syncedAt).toLocaleString("en-GB", { timeZone: "Asia/Karachi" }).replaceAll("/", "-") : "No sync yet"}</p></div><CloudUpload size={22} /></div>
      <p>{status.configured ? "Cloud token saved on this device." : "Enter the token from the server configuration to enable automatic uploads."}</p>
      <form className="grid-form" onSubmit={e => {
        e.preventDefault(); const form = e.currentTarget; const token = field(new FormData(form), "token");
        void run(async () => { await db.device.put({ key: "syncToken", value: token }); form.reset(); done(token ? "Cloud token saved." : "Cloud token removed."); });
      }}><Field name="Cloud sync token" wide><input name="token" type="password" autoComplete="off" placeholder={status.configured ? "Enter replacement or leave blank to remove" : "Token from server"} /></Field><div className="actions wide"><Button type="submit">Save token</Button><Button className="primary" onClick={syncNow}>Sync now</Button></div></form>
    </section>}
  </div>;
}
