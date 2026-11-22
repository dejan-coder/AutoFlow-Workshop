-- Modul 1: Kunder och fordon
CREATE TABLE customers (
  id              BIGSERIAL PRIMARY KEY,
  customer_type   TEXT NOT NULL CHECK (customer_type IN ('private', 'company')),
  name            TEXT NOT NULL,
  identity_number TEXT,              -- personnummer eller organisationsnummer
  email           TEXT,
  phone           TEXT,
  street          TEXT,
  postal_code     TEXT,
  city            TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customers_name_idx ON customers (lower(name));
CREATE INDEX customers_phone_idx ON customers (phone);

CREATE TABLE vehicles (
  id                  BIGSERIAL PRIMARY KEY,
  registration_number TEXT NOT NULL UNIQUE,
  customer_id         BIGINT REFERENCES customers(id) ON DELETE RESTRICT,
  make                TEXT,
  model               TEXT,
  model_year          INTEGER CHECK (model_year BETWEEN 1900 AND 2100),
  vin                 TEXT,
  fuel                TEXT CHECK (fuel IN ('petrol', 'diesel', 'electric', 'hybrid', 'plugin_hybrid', 'gas', 'other')),
  mileage_km          INTEGER CHECK (mileage_km >= 0),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_customer_idx ON vehicles (customer_id);
