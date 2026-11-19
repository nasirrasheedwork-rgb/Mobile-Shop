# Mobile Shop CRM

## Run on the shop PC

In PowerShell from the project folder:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd start -- --hostname 127.0.0.1
```

Open http://localhost:3000/ in Chrome. Create the owner PIN or restore a JSON backup. Wait until the sidebar shows **Offline ready**, then use **Install app**. Use the same URL and Chrome profile to access the same local data. **F2** opens Sell, **F3** Purchase and **F4** Return. The scanner sends the IMEI followed by Enter.

In **Command Center → Settings**, enter the receipt and bank details, set the auto-lock interval, and export backups. Restoring replaces the local shop data and uses the PIN from the backup.

At checkout, scan an in-stock IMEI to load the phone and its price. Enter the cash payment and select a bank for any financed balance. A financed sale requires a 13-digit CNIC. Its bank payment starts **Pending** and can be marked **Received** in the selected bank ledger. The Cash ledger tracks physical cash collected and cash refunded. Choose **Save & generate receipt** to open the receipt, then **Print / Save PDF** for A4 or 80 mm paper. Saved receipts are also available from the **Sales** table.

## Try the sample data

Click **Try demo** on the sign-in screen, or open http://localhost:3000/?demo=1 directly. Unlock with PIN **1234**. The demo includes 18 phones, nine customers and sales, and sample bank payments and returns. The demo uses a separate IndexedDB database and stays local to the browser. Use **Open shop** to return to your shop records.

## Enable cloud uploads

Use a PostgreSQL database for this shop and apply `sql/cloud.sql`. Copy `.env.example` to `.env.local`, set `DATABASE_URL` and a random `SYNC_TOKEN` of at least 24 characters, and restart the app server. Enter the same token in **Command Center → Sync**. Changes queue locally and upload when the browser and API can reach the database. **Sync now** retries and reports connection errors.

For optional online model lookup, configure `TAC_LOOKUP_URL` and, if required, `TAC_LOOKUP_TOKEN`. The provider receives an eight-digit `tac` query parameter. It must return a JSON object with `brand` and `model`, optionally including `storage`, `ram`, `color`, `specs` (a string-to-string object), `default_cost`, and `default_price`. Once saved, the TAC works offline.

Run `npm.cmd run typecheck` and `npm.cmd test` to check the TypeScript and local transaction rules.
