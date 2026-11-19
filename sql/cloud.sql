BEGIN;

CREATE TABLE IF NOT EXISTS settings (
  id uuid PRIMARY KEY, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, synced boolean NOT NULL,
  shop text NOT NULL, address text NOT NULL, phone text NOT NULL,
  "BANK_A" jsonb NOT NULL, "BANK_B" jsonb NOT NULL, pin_hash text NOT NULL, salt text NOT NULL,
  lock_minutes integer NOT NULL CHECK (lock_minutes BETWEEN 1 AND 1440)
);

CREATE TABLE IF NOT EXISTS models (
  id uuid PRIMARY KEY, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, synced boolean NOT NULL,
  brand text NOT NULL, model text NOT NULL, storage text NOT NULL, ram text NOT NULL, color text NOT NULL,
  specs jsonb NOT NULL, tac_codes text[] NOT NULL, default_cost integer NOT NULL CHECK (default_cost >= 0),
  default_price integer NOT NULL CHECK (default_price >= 0)
);

CREATE TABLE IF NOT EXISTS phones (
  id uuid PRIMARY KEY, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, synced boolean NOT NULL,
  imei text NOT NULL UNIQUE, model_id uuid NOT NULL, color text NOT NULL, condition text NOT NULL,
  cost_price integer NOT NULL CHECK (cost_price >= 0), sale_price integer NOT NULL CHECK (sale_price >= 0),
  supplier text NOT NULL, purchase_date date NOT NULL, notes text NOT NULL,
  status text NOT NULL CHECK (status IN ('IN_STOCK','SOLD','RETURNED','DEFECTIVE'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, synced boolean NOT NULL,
  imei text NOT NULL, model_id uuid NOT NULL, color text NOT NULL, condition text NOT NULL,
  cost_price integer NOT NULL CHECK (cost_price >= 0), sale_price integer NOT NULL CHECK (sale_price >= 0),
  supplier text NOT NULL, purchase_date date NOT NULL, notes text NOT NULL, phone_id uuid NOT NULL, label text NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, synced boolean NOT NULL,
  name text NOT NULL, phone text NOT NULL UNIQUE, cnic text NOT NULL, address text NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, synced boolean NOT NULL,
  sale_no text NOT NULL UNIQUE, phone_id uuid NOT NULL, customer_id uuid NOT NULL, phone_label text NOT NULL, imei text NOT NULL,
  phone_color text NOT NULL, phone_condition text NOT NULL, customer_name text NOT NULL, customer_phone text NOT NULL,
  total integer NOT NULL CHECK (total >= 0), cash_amount integer NOT NULL CHECK (cash_amount >= 0),
  bank_id text CHECK (bank_id IN ('BANK_A','BANK_B')), bank_amount integer NOT NULL CHECK (bank_amount >= 0),
  bank_status text CHECK (bank_status IN ('PENDING','RECEIVED','CANCELLED')), received_date date, reference_no text NOT NULL,
  profit integer NOT NULL, status text NOT NULL CHECK (status IN ('COMPLETED','RETURNED')), sale_date date NOT NULL,
  CHECK (total = cash_amount + bank_amount),
  CHECK ((bank_amount = 0 AND bank_id IS NULL AND bank_status IS NULL)
      OR (bank_amount > 0 AND bank_id IS NOT NULL AND bank_status IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS "returns" (
  id uuid PRIMARY KEY, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, synced boolean NOT NULL,
  sale_id uuid NOT NULL UNIQUE, phone_id uuid NOT NULL, reason text NOT NULL,
  cash_refund integer NOT NULL CHECK (cash_refund >= 0), bank_adjustment integer NOT NULL CHECK (bank_adjustment >= 0),
  return_date date NOT NULL, disposition text NOT NULL CHECK (disposition IN ('IN_STOCK','DEFECTIVE')), notes text NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, synced boolean NOT NULL,
  account text NOT NULL CHECK (account IN ('CASH','BANK_A','BANK_B')),
  type text NOT NULL CHECK (type IN ('IN','OUT','ADJUSTMENT')), amount integer NOT NULL CHECK (amount >= 0),
  status text NOT NULL CHECK (status IN ('PENDING','RECEIVED','CANCELLED')), ref_type text NOT NULL CHECK (ref_type IN ('SALE','RETURN')),
  ref_id uuid NOT NULL, sale_id uuid NOT NULL, date date NOT NULL, received_date date, reference_no text NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, synced boolean NOT NULL,
  action text NOT NULL, entity text NOT NULL, entity_id uuid NOT NULL, data jsonb NOT NULL, timestamp timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS purchases_phone ON purchases (phone_id, purchase_date);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS receipt_details jsonb;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS items jsonb;
CREATE INDEX IF NOT EXISTS sales_customer ON sales (customer_id, sale_date);
CREATE INDEX IF NOT EXISTS sales_phone ON sales (phone_id, sale_date);
CREATE INDEX IF NOT EXISTS ledger_account ON ledger_entries (account, date);
CREATE INDEX IF NOT EXISTS audit_timestamp ON audit_log (timestamp);
COMMIT;
