-- Inställningar för verkstaden (en rad)
CREATE TABLE workshop_settings (
  id                 INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name       TEXT NOT NULL DEFAULT 'Min verkstad',
  org_number         TEXT,
  vat_number         TEXT,
  street             TEXT,
  postal_code        TEXT,
  city               TEXT,
  phone              TEXT,
  email              TEXT,
  bankgiro           TEXT,
  default_hourly_rate NUMERIC(12,2) NOT NULL DEFAULT 950,
  payment_terms_days INTEGER NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 120),
  quote_valid_days   INTEGER NOT NULL DEFAULT 30 CHECK (quote_valid_days BETWEEN 1 AND 365),
  invoice_footer     TEXT
);
INSERT INTO workshop_settings (id) VALUES (1);

-- Mekaniker / personal
CREATE TABLE mechanics (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Modul 4: Artiklar och lager
CREATE TABLE articles (
  id             BIGSERIAL PRIMARY KEY,
  article_number TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  unit           TEXT NOT NULL DEFAULT 'st',
  purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  sale_price     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  vat_rate       NUMERIC(5,2) NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 6, 12, 25)),
  track_stock    BOOLEAN NOT NULL DEFAULT true,
  stock_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  reorder_level  NUMERIC(12,2),
  supplier       TEXT,
  location       TEXT,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX articles_name_idx ON articles (lower(name));

-- Modul 2: Arbetsordrar
CREATE TABLE work_orders (
  id          BIGSERIAL PRIMARY KEY,
  vehicle_id  BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  mechanic_id BIGINT REFERENCES mechanics(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'invoiced', 'cancelled')),
  description TEXT,
  internal_notes TEXT,
  mileage_km  INTEGER CHECK (mileage_km >= 0),
  promised_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX work_orders_vehicle_idx ON work_orders (vehicle_id);
CREATE INDEX work_orders_customer_idx ON work_orders (customer_id);
CREATE INDEX work_orders_status_idx ON work_orders (status);

CREATE TABLE work_order_lines (
  id               BIGSERIAL PRIMARY KEY,
  work_order_id    BIGINT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  line_type        TEXT NOT NULL CHECK (line_type IN ('labor', 'article', 'other')),
  article_id       BIGINT REFERENCES articles(id) ON DELETE RESTRICT,
  description      TEXT NOT NULL,
  quantity         NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit             TEXT NOT NULL DEFAULT 'st',
  unit_price       NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  vat_rate         NUMERIC(5,2) NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 6, 12, 25)),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX work_order_lines_order_idx ON work_order_lines (work_order_id);

CREATE TABLE stock_movements (
  id            BIGSERIAL PRIMARY KEY,
  article_id    BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  quantity      NUMERIC(12,2) NOT NULL,
  reason        TEXT NOT NULL CHECK (reason IN ('purchase', 'adjustment', 'work_order', 'count')),
  work_order_id BIGINT REFERENCES work_orders(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_article_idx ON stock_movements (article_id);

-- Modul 3: Tidbok
CREATE TABLE bookings (
  id               BIGSERIAL PRIMARY KEY,
  starts_at        TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 15 AND 1440),
  mechanic_id      BIGINT REFERENCES mechanics(id) ON DELETE SET NULL,
  vehicle_id       BIGINT REFERENCES vehicles(id) ON DELETE SET NULL,
  customer_id      BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  description      TEXT,
  status           TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'arrived', 'cancelled', 'no_show')),
  work_order_id    BIGINT REFERENCES work_orders(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bookings_starts_idx ON bookings (starts_at);

-- Modul 5: Offert och faktura
CREATE TABLE quotes (
  id            BIGSERIAL PRIMARY KEY,
  customer_id   BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  vehicle_id    BIGINT REFERENCES vehicles(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected')),
  description   TEXT,
  valid_until   DATE NOT NULL,
  work_order_id BIGINT REFERENCES work_orders(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE quote_lines (
  id               BIGSERIAL PRIMARY KEY,
  quote_id         BIGINT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  line_type        TEXT NOT NULL CHECK (line_type IN ('labor', 'article', 'other')),
  article_id       BIGINT REFERENCES articles(id) ON DELETE SET NULL,
  description      TEXT NOT NULL,
  quantity         NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit             TEXT NOT NULL DEFAULT 'st',
  unit_price       NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  vat_rate         NUMERIC(5,2) NOT NULL DEFAULT 25 CHECK (vat_rate IN (0, 6, 12, 25)),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX quote_lines_quote_idx ON quote_lines (quote_id);

CREATE SEQUENCE invoice_number_seq START 1001;
CREATE TABLE invoices (
  id               BIGSERIAL PRIMARY KEY,
  invoice_number   BIGINT NOT NULL UNIQUE DEFAULT nextval('invoice_number_seq'),
  invoice_type     TEXT NOT NULL DEFAULT 'invoice' CHECK (invoice_type IN ('invoice', 'credit')),
  credited_invoice_id BIGINT REFERENCES invoices(id),
  work_order_id    BIGINT REFERENCES work_orders(id) ON DELETE RESTRICT,
  customer_id      BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  -- Ögonblicksbild av kund och fordon när fakturan skapades
  customer_name    TEXT NOT NULL,
  customer_identity_number TEXT,
  customer_address TEXT,
  registration_number TEXT,
  mileage_km       INTEGER,
  invoice_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date         DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'credited')),
  paid_at          DATE,
  net_amount       NUMERIC(12,2) NOT NULL,
  vat_amount       NUMERIC(12,2) NOT NULL,
  rounding         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount     NUMERIC(12,2) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invoices_one_active_per_order ON invoices (work_order_id)
  WHERE invoice_type = 'invoice' AND status <> 'credited';

CREATE TABLE invoice_lines (
  id               BIGSERIAL PRIMARY KEY,
  invoice_id       BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_type        TEXT NOT NULL,
  description      TEXT NOT NULL,
  quantity         NUMERIC(12,2) NOT NULL,
  unit             TEXT NOT NULL,
  unit_price       NUMERIC(12,2) NOT NULL,
  discount_percent NUMERIC(5,2) NOT NULL,
  vat_rate         NUMERIC(5,2) NOT NULL,
  net_amount       NUMERIC(12,2) NOT NULL,
  sort_order       INTEGER NOT NULL DEFAULT 0
);
