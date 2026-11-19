"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { saleItems, type Sale, type Settings } from "@/lib/schema";
import { label, pkr, showDate } from "@/lib/format";
import { Button, Modal } from "./ui";

function Slip({ sale, settings, thermal }: { sale: Sale; settings: Settings; thermal: boolean }) {
  const bank = sale.bank_id ? settings[sale.bank_id] : null;
  const details = sale.receipt_details;
  const items = saleItems(sale);
  return <article className={thermal ? "receipt thermal" : "receipt"}>
    <header className="receipt-shop">
      <h2>{settings.shop}</h2>
      {settings.address && <address>{settings.address}</address>}
      {settings.phone && <p>{settings.phone}</p>}
    </header>

    <div className="receipt-content">
      <div className="receipt-title">
        <h3>Purchase receipt</h3>
        {sale.status === "RETURNED" && <strong>Returned</strong>}
      </div>
      <dl className="receipt-meta">
        <div><dt>Receipt no.</dt><dd>{sale.sale_no}</dd></div>
        <div><dt>Date</dt><dd>{showDate(sale.sale_date)}</dd></div>
        <div><dt>Customer</dt><dd>{sale.customer_name}</dd></div>
        <div><dt>Phone</dt><dd>{sale.customer_phone}</dd></div>
        {details?.customer_cnic && <div><dt>CNIC</dt><dd>{details.customer_cnic}</dd></div>}
        {details?.customer_address && <div className="receipt-address"><dt>Customer address</dt><dd>{details.customer_address}</dd></div>}
      </dl>

      <section className="receipt-section">
        <h4>Product details</h4>
        <table className="receipt-items" aria-label="Receipt items">
          <thead><tr><th scope="col">Phone / IMEI</th><th scope="col">Price</th></tr></thead>
          <tbody>{items.map(item => {
            const specs = [item.storage && "Storage " + item.storage, item.ram && "RAM " + item.ram,
              ...Object.entries(item.specs).map(([name, value]) => name + " " + value)].filter(Boolean);
            return <tr key={item.phone_id}><td>
              <strong>{item.phone_label}</strong>
              <p>IMEI {item.imei}</p>
              <p>{[item.color, item.condition].filter(Boolean).join(" · ")}</p>
              {specs.length > 0 && <p>{specs.join(" · ")}</p>}
            </td><td>{pkr(item.price)}</td></tr>;
          })}</tbody>
        </table>
      </section>

      <section className="receipt-section">
        <h4>Payment</h4>
        <dl className="receipt-payment">
          <div><dt>Cash paid</dt><dd>{pkr(sale.cash_amount)}</dd></div>
          {bank && <>
            <div><dt>{bank.bank}<span>{bank.company}</span></dt><dd>{pkr(sale.bank_amount)}</dd></div>
            <div><dt>Bank payment status</dt><dd>{label(sale.bank_status)}</dd></div>
            {sale.received_date && <div><dt>Received date</dt><dd>{showDate(sale.received_date)}</dd></div>}
            {sale.reference_no && <div><dt>Bank reference</dt><dd>{sale.reference_no}</dd></div>}
          </>}
          <div className="receipt-total"><dt>Total</dt><dd>{pkr(sale.total)}</dd></div>
        </dl>
      </section>
    </div>

    <footer className="receipt-credit">
      <p>Slip created by <strong>Rasheedsystems.com</strong></p>
      <p className="receipt-contacts"><span>+923458066158</span><span>+923359112095</span></p>
    </footer>
  </article>;
}

export function Receipt({ sale, settings, close }: { sale: Sale; settings: Settings; close: () => void }) {
  const [paper, setPaper] = useState("A4");
  const thermal = paper === "80mm thermal";
  const [thermalHeight, setThermalHeight] = useState(180);
  const printArea = useRef<HTMLDivElement>(null);
  const slip = { sale, settings, thermal };

  useLayoutEffect(() => {
    if (!thermal) return;
    const receipt = printArea.current?.querySelector(".receipt");
    if (!receipt) return;
    const measure = () => {
      // CSS pixels are 96 per inch. Allow 3 mm per margin and 2 mm for rounding.
      const height = receipt.getBoundingClientRect().height;
      if (height > 0) setThermalHeight(Math.ceil(height * 25.4 / 96) + 8);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(receipt);
    return () => observer.disconnect();
  }, [thermal]);

  return <>
    <Modal title={"Receipt " + sale.sale_no} close={close}>
      <Slip {...slip} />
      <div className="actions screen-only">
        <select aria-label="Print format" value={paper} onChange={e => setPaper(e.target.value)}><option>A4</option><option>80mm thermal</option></select>
        <Button className="primary" onClick={() => window.print()}><Printer size={16} /> Print / Save PDF</Button>
      </div>
    </Modal>
    {createPortal(<div ref={printArea} className={thermal ? "receipt-print receipt-print-thermal" : "receipt-print"}>
      <style>{thermal ? "@page { size: 80mm " + thermalHeight + "mm; margin: 3mm; }" : "@page { size: A4; margin: 14mm; }"}</style>
      <Slip {...slip} />
    </div>, document.body)}
  </>;
}
