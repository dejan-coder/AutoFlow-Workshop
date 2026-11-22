-- Inloggning och behörighet
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'office', 'mechanic')),
  mechanic_id   BIGINT REFERENCES mechanics(id) ON DELETE SET NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_idx ON users (lower(email));

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- SMS till kund
CREATE TABLE messages (
  id            BIGSERIAL PRIMARY KEY,
  channel       TEXT NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms')),
  kind          TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'booking_confirmation', 'booking_reminder', 'vehicle_ready', 'service_reminder')),
  to_phone      TEXT NOT NULL,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'logged')),
  provider      TEXT NOT NULL,
  error         TEXT,
  customer_id   BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_id    BIGINT REFERENCES vehicles(id) ON DELETE SET NULL,
  work_order_id BIGINT REFERENCES work_orders(id) ON DELETE SET NULL,
  booking_id    BIGINT REFERENCES bookings(id) ON DELETE SET NULL,
  sent_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_customer_idx ON messages (customer_id);
ALTER TABLE bookings ADD COLUMN reminder_sent_at TIMESTAMPTZ;

ALTER TABLE workshop_settings
  ADD COLUMN sms_sender TEXT NOT NULL DEFAULT 'Verkstaden',
  ADD COLUMN sms_booking_template TEXT NOT NULL DEFAULT 'Hej {kund}! Din tid för {regnr} är bokad {datum} kl {tid}. Välkommen! /{verkstad}',
  ADD COLUMN sms_reminder_template TEXT NOT NULL DEFAULT 'Påminnelse: {regnr} är bokad hos oss i morgon {datum} kl {tid}. /{verkstad} {telefon}',
  ADD COLUMN sms_ready_template TEXT NOT NULL DEFAULT 'Hej {kund}! Din bil {regnr} är klar att hämta. Att betala: {belopp}. /{verkstad} {telefon}',
  ADD COLUMN sms_service_template TEXT NOT NULL DEFAULT 'Hej {kund}! Det är snart dags för {vad} för {regnr}. Boka tid på {telefon}. /{verkstad}',
  -- Kontoplan för bokföringsexport (BAS)
  ADD COLUMN acc_receivable TEXT NOT NULL DEFAULT '1510',
  ADD COLUMN acc_bank TEXT NOT NULL DEFAULT '1930',
  ADD COLUMN acc_sales_25 TEXT NOT NULL DEFAULT '3001',
  ADD COLUMN acc_sales_12 TEXT NOT NULL DEFAULT '3002',
  ADD COLUMN acc_sales_6 TEXT NOT NULL DEFAULT '3003',
  ADD COLUMN acc_sales_0 TEXT NOT NULL DEFAULT '3004',
  ADD COLUMN acc_vat_25 TEXT NOT NULL DEFAULT '2611',
  ADD COLUMN acc_vat_12 TEXT NOT NULL DEFAULT '2621',
  ADD COLUMN acc_vat_6 TEXT NOT NULL DEFAULT '2631',
  ADD COLUMN acc_rounding TEXT NOT NULL DEFAULT '3740';

-- Service och besiktning
ALTER TABLE vehicles
  ADD COLUMN next_service_date DATE,
  ADD COLUMN next_service_km INTEGER CHECK (next_service_km >= 0),
  ADD COLUMN inspection_due DATE,
  ADD COLUMN service_reminder_sent_at TIMESTAMPTZ;

-- Däckhotell
CREATE TABLE tire_storage (
  id             BIGSERIAL PRIMARY KEY,
  customer_id    BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  vehicle_id     BIGINT REFERENCES vehicles(id) ON DELETE SET NULL,
  location       TEXT NOT NULL,
  season         TEXT NOT NULL CHECK (season IN ('summer', 'winter', 'all_season')),
  tire_size      TEXT,
  brand          TEXT,
  tread_depth_mm NUMERIC(4,1) CHECK (tread_depth_mm BETWEEN 0 AND 20),
  with_rims      BOOLEAN NOT NULL DEFAULT false,
  quantity       INTEGER NOT NULL DEFAULT 4 CHECK (quantity BETWEEN 1 AND 10),
  stored_at      DATE NOT NULL DEFAULT CURRENT_DATE,
  retrieved_at   DATE,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tire_storage_location_active ON tire_storage (lower(location)) WHERE retrieved_at IS NULL;
CREATE INDEX tire_storage_vehicle_idx ON tire_storage (vehicle_id);
