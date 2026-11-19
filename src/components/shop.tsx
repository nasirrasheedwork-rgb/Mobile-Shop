"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Boxes, Box, Building2, ChevronRight, CircleAlert, Cloud, Download, LayoutDashboard, ListOrdered, LockKeyhole, Menu, Moon, RotateCcw, Settings2, ShoppingBag, Smartphone, Sun, Users, Wallet, Wifi, WifiOff } from "lucide-react";
import { db, demoMode, snapshot, checkPin, setPin } from "@/lib/db";
import { sync } from "@/lib/sync";
import { demoPin, prepareDemo } from "@/lib/demo";
import type { Sale } from "@/lib/schema";
import { Dashboard } from "./dashboard";
import { Checkout, Purchase, Return } from "./workflows";
import { Customers, Inventory, Ledger, Sales } from "./tables";
import { Command, Restore } from "./command";
import { Receipt } from "./receipt";
import { ActionErrorContext, Button, Field, errorText } from "./ui";

const links = [
  { id: "dashboard", name: "Dashboard", icon: LayoutDashboard, description: "Sales, balances and stock at a glance." },
  { id: "sell", name: "Sell", icon: ShoppingBag, key: "F2", description: "Record cash and financed sales." },
  { id: "purchase", name: "Purchase", icon: Box, key: "F3", description: "Scan phones and add stock." },
  { id: "return", name: "Return", icon: RotateCcw, key: "F4", description: "Record a return and reconcile the original sale." },
  { id: "inventory", name: "Inventory", icon: Boxes, description: "Browse phone stock and IMEI history." },
  { id: "sales", name: "Sales", icon: ListOrdered, description: "Review sales and reprint receipts." },
  { id: "customers", name: "Customers", icon: Users, description: "Find customers and view their purchase history." },
  { id: "bank-a", name: "Bank A", icon: Building2, description: "Review and confirm finance payments." },
  { id: "bank-b", name: "Bank B", icon: Building2, description: "Review and confirm finance payments." },
  { id: "cash", name: "Cash", icon: Wallet, description: "Physical cash only. Bank transfers appear in their bank ledgers." },
  { id: "command", name: "Command Center", icon: Settings2, description: "Reports, catalog, settings, backup and sync." },
];

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function Shop() {
  const [page, setPage] = useState("dashboard");
  const activePage = useRef("dashboard");
  const pageKey = demoMode ? "mobile-shop-demo-page" : "mobile-shop-page";
  const [demoSetup, setDemoSetup] = useState<"pending" | "ready" | "error">("pending");
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [online, setOnline] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [install, setInstall] = useState<InstallEvent>();
  const [receipt, setReceipt] = useState<Sale>();
  const [flash, setFlash] = useState<{ msg: string; error?: boolean }>();
  const [storage, setStorage] = useState<"denied" | "granted">();
  const [sessionHash, setSessionHash] = useState("");
  const [lockError, setLockError] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const state = useLiveQuery(async () => ({
    data: await snapshot(), unsynced: await db.sync_queue.count(),
    backup: (await db.device.get("lastBackup"))?.value ?? "",
    syncedAt: (await db.device.get("lastSync"))?.value ?? "",
    configured: !demoMode && !!(await db.device.get("syncToken"))?.value,
  }), []);
  const settings = state?.data.settings[0];
  const lockMinutes = settings?.lock_minutes;
  const unlocked = open && settings?.pin_hash === sessionHash;
  const selected = links.find(link => link.id === page) ?? links[0];
  const name = (id: string, fallback: string) => id === "bank-a" ? settings?.BANK_A.bank ?? fallback : id === "bank-b" ? settings?.BANK_B.bank ?? fallback : fallback;

  const go = useCallback((next: string) => {
    const hash = "#" + next;
    activePage.current = next;
    sessionStorage.setItem(pageKey, next);
    if (location.hash !== hash) history.pushState(null, "", hash);
    setPage(next);
    setExpanded(false);
    setLockError("");
  }, [pageKey]);
  const lock = useCallback(() => { setOpen(false); setSessionHash(""); setReceipt(undefined); setLockError(""); }, []);
  const notify = useCallback((msg: string, error = false) => {
    setFlash({ msg, error });
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setFlash(undefined), 5000);
  }, []);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true); setLockError("");
    try { await action(); }
    catch (error) {
      const message = errorText(error);
      setLockError(message); notify(message, true);
    }
    finally { busy.current = false; setPending(false); }
  }, [notify]);

  useEffect(() => {
    if (demoMode) void prepareDemo().then(() => setDemoSetup("ready"), () => setDemoSetup("error"));
  }, []);

  useEffect(() => {
    const connection = () => setOnline(navigator.onLine);
    const route = () => {
      const id = location.hash.slice(1);
      if (id !== "dashboard" && links.some(link => link.id === id)) {
        activePage.current = id;
        sessionStorage.setItem(pageKey, id);
        setPage(id);
      }
      // Dashboard requires explicit navigation. A browser event may replay an old URL.
      const hash = "#" + activePage.current;
      if (location.hash !== hash) history.replaceState(null, "", hash);
    };
    const prompt = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvent); };
    const onInstalled = () => { setInstalled(true); setInstall(undefined); };
    connection();
    const initialRoute = requestAnimationFrame(() => {
      const saved = sessionStorage.getItem(pageKey);
      if (saved && links.some(link => link.id === saved)) {
        activePage.current = saved;
        setPage(saved);
      }
      route();
    });
    setDark(localStorage.getItem("mobile-shop-theme") === "dark");
    setInstalled(matchMedia("(display-mode: standalone)").matches);
    void navigator.storage?.persist?.().then(granted => setStorage(granted ? "granted" : "denied")).catch(() => setStorage("denied"));
    void navigator.serviceWorker?.ready.then(() => setOfflineReady(true));
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    window.addEventListener("hashchange", route);
    window.addEventListener("popstate", route);
    window.addEventListener("beforeinstallprompt", prompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      cancelAnimationFrame(initialRoute);
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
      window.removeEventListener("hashchange", route);
      window.removeEventListener("popstate", route);
      window.removeEventListener("beforeinstallprompt", prompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [pageKey]);
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);

  useEffect(() => {
    const serviceWorkers = navigator.serviceWorker;
    if (!serviceWorkers) return;
    let hadController = !!serviceWorkers.controller;
    let checking = false;
    const checkForUpdate = async () => {
      if (!navigator.onLine || checking) return;
      checking = true;
      try {
        const registration = await serviceWorkers.getRegistration();
        if (registration?.active) await registration.update();
      } catch {
        // The installed version remains available when the server cannot be reached.
      } finally {
        checking = false;
      }
    };
    const controllerChanged = () => {
      if (!serviceWorkers.controller) return;
      if (hadController) setUpdateReady(true);
      hadController = true;
    };
    serviceWorkers.addEventListener("controllerchange", controllerChanged);
    window.addEventListener("focus", checkForUpdate);
    window.addEventListener("online", checkForUpdate);
    void checkForUpdate();
    return () => {
      serviceWorkers.removeEventListener("controllerchange", controllerChanged);
      window.removeEventListener("focus", checkForUpdate);
      window.removeEventListener("online", checkForUpdate);
    };
  }, []);

  useEffect(() => {
    if (!unlocked || !lockMinutes) return;
    const keys = (e: KeyboardEvent) => {
      const screen = links.find(link => link.key && link.key === e.key);
      if (screen && !document.querySelector("dialog[open]")) { e.preventDefault(); go(screen.id); }
    };
    let last = Date.now();
    const touch = () => { last = Date.now(); };
    const check = () => { if (Date.now() - last >= lockMinutes * 60000) lock(); };
    const timer = setInterval(check, 1000);
    window.addEventListener("keydown", keys);
    window.addEventListener("keydown", touch);
    window.addEventListener("pointerdown", touch);
    window.addEventListener("pointermove", touch);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", keys);
      window.removeEventListener("keydown", touch);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("pointermove", touch);
      document.removeEventListener("visibilitychange", check);
    };
  }, [unlocked, lockMinutes, go, lock]);

  useEffect(() => {
    if (!online || !state?.configured || !state.unsynced) return;
    const upload = () => { void sync().catch(() => { /* Manual sync reports any connection failure. */ }); };
    const soon = setTimeout(upload, 1000);
    const interval = setInterval(upload, 60000);
    return () => { clearTimeout(soon); clearInterval(interval); };
  }, [online, state?.configured, state?.unsynced]);

  async function installApp() {
    if (!install) { notify(offlineReady ? "Use Chrome’s Install page as app option in the browser menu." : "Open the production build once to prepare offline installation."); return; }
    await install.prompt();
    if ((await install.userChoice).outcome === "accepted") setInstalled(true);
    setInstall(undefined);
  }

  const updateButton = updateReady && <Button onClick={() => location.reload()}>Reload to update</Button>;
  const toast = flash && <div className={"toast " + (flash.error ? "toast-error" : "")} role={flash.error ? "alert" : "status"}>{flash.error && <CircleAlert size={18} />}{flash.msg}</div>;
  if (!state || (demoMode && demoSetup !== "ready")) return <main className="auth-shell"><div className="auth-card"><Smartphone /><h1>Mobile Shop</h1><p>{demoSetup === "error" ? "Demo setup could not finish. Reload to try again." : "Opening local storage…"}</p></div></main>;
  if (!unlocked || !settings) return <ActionErrorContext.Provider value={lockError}><main className="auth-shell">
    <div className="auth-card">
      <div className="brand-icon"><Smartphone size={26} /></div>
      <h1>{settings?.shop ?? "Set up Mobile Shop"}</h1>
      <p>{settings ? "Enter your owner PIN to unlock the shop." : "Create the owner PIN or restore an existing backup."}</p>
      {demoMode && <p className="spec-strip">Sample data · Demo PIN {demoPin}</p>}
      <form className="stack" onSubmit={e => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void run(async () => {
          const pin = String(f.get("pin") ?? "");
          if (settings) {
            if (!(await checkPin(pin, settings))) throw Error("Incorrect owner PIN.");
            setSessionHash(settings.pin_hash);
          } else {
            if (pin !== f.get("repeat")) throw Error("The PIN entries do not match.");
            setSessionHash((await setPin(pin)).pin_hash);
          }
          setOpen(true);
        });
      }}>
        <Field name="Owner PIN or password"><input name="pin" type="password" required autoFocus minLength={settings ? 1 : 4} maxLength={128} autoComplete={settings ? "current-password" : "new-password"} /></Field>
        {!settings && <Field name="Confirm PIN"><input name="repeat" type="password" autoComplete="new-password" minLength={4} required /></Field>}
        {lockError && <p className="form-error">{lockError}</p>}
        <Button type="submit" className="primary" disabled={pending}>{settings ? "Unlock shop" : "Create owner PIN"}</Button>
      </form>
      <div className="actions">{updateButton}{!settings && <Restore run={run} onRestored={lock} />}{demoMode ? <a className="button" href="/">Open shop</a> : <a className="button" href="/?demo=1">Try demo</a>}{!demoMode && !installed && <Button onClick={installApp}><Download size={16} /> Install app</Button>}</div>
    </div>{toast}
  </main></ActionErrorContext.Provider>;

  const data = state.data;
  const common = { data, run, done: notify };
  const salesProps = { data, settings, run, receipt: setReceipt };

  return <ActionErrorContext.Provider value={lockError}><div className="shell">
    <aside className={"sidebar " + (expanded ? "expanded" : "")}>
      <div className="brand"><div className="brand-icon"><Smartphone size={22} /></div><div><strong>{settings.shop}</strong><small>Shop management</small></div></div>
      <nav aria-label="Main navigation">
        {links.map((link, i) => <div key={link.id}>
          {i === 0 && <span className="nav-label">Workspace</span>}{i === 7 && <span className="nav-label">Finance</span>}
          <button className={"nav-item " + (page === link.id ? "active" : "")} aria-current={page === link.id ? "page" : undefined} onClick={() => go(link.id)}><link.icon size={18} /><span>{name(link.id, link.name)}</span>{link.key && <kbd>{link.key}</kbd>}</button>
        </div>)}
      </nav>
      <div className="sidebar-foot"><span className="avatar">O</span><div><strong>Shop owner</strong><small>{offlineReady ? "Offline ready" : "Local workspace"}</small></div><Button className="icon-btn" aria-label="Lock shop" onClick={lock}><LockKeyhole size={17} /></Button></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="crumbs"><Button className="menu icon-btn" aria-label="Toggle navigation" onClick={() => setExpanded(!expanded)}><Menu size={18} /></Button><span>Workspace</span><ChevronRight size={14} /><b>{name(selected.id, selected.name)}</b></div>
        <div className="top-actions">
          {updateButton}
          <span className={"connection " + (online ? "online" : "")}>{online ? <Wifi size={15} /> : <WifiOff size={15} />}{online ? "Online" : "Offline"}</span>
          {demoMode ? <><span className="sync-warning">Sample data</span><a className="button" href="/">Open shop</a></> : <a className="button" href="/?demo=1" target="_blank" rel="noopener">Try demo</a>}
          {!demoMode && state.unsynced > 0 && <button className="sync-warning" onClick={() => go("command")} title="Open Command Center for cloud sync"><Cloud size={16} /> {state.unsynced} records not synced</button>}
          {!demoMode && !installed && <Button className="install" onClick={installApp}><Download size={16} /> Install app</Button>}
          <Button className="icon-btn" aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} onClick={() => { localStorage.setItem("mobile-shop-theme", dark ? "light" : "dark"); setDark(!dark); }}>{dark ? <Sun size={18} /> : <Moon size={18} />}</Button>
        </div>
      </header>
      <main className="content">
        <div className="page-head"><h1>{name(selected.id, selected.name)}</h1><p>{selected.description}</p></div>
        {storage === "denied" && <div className="notice"><CircleAlert size={17} /> The browser declined persistent storage. Export backups regularly.</div>}
        <div key={page}>
          {page === "dashboard" && <Dashboard data={data} settings={settings} go={go} receipt={setReceipt} />}
          {page === "sell" && <Checkout {...common} settings={settings} receipt={setReceipt} />}
          {page === "purchase" && <Purchase {...common} />}
          {page === "return" && <Return {...common} />}
          {page === "inventory" && <Inventory data={data} run={run} />}
          {page === "sales" && <Sales {...salesProps} />}
          {page === "customers" && <Customers {...salesProps} />}
          {page === "bank-a" && <Ledger account="BANK_A" {...common} />}
          {page === "bank-b" && <Ledger account="BANK_B" {...common} />}
          {page === "cash" && <Ledger account="CASH" {...common} />}
          {page === "command" && <Command {...common} settings={settings} status={state} onRestored={lock} syncNow={() => run(async () => { const uploaded = await sync(); notify(uploaded ? uploaded + " records synced." : "Everything is synced."); })} />}
        </div>
      </main>
    </div>
    {receipt && <Receipt sale={data.sales.find(s => s.id === receipt.id) ?? receipt} settings={settings} close={() => setReceipt(undefined)} />}
    {toast}
  </div></ActionErrorContext.Provider>;
}
