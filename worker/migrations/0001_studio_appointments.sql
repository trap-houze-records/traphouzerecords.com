CREATE TABLE studio_appointments (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  guest_name TEXT,
  guest_phone TEXT,
  service TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_at > starts_at),
  CHECK (client_id IS NOT NULL OR guest_name IS NOT NULL)
);

CREATE INDEX studio_appointments_starts_at ON studio_appointments(starts_at);
CREATE INDEX studio_appointments_client_id ON studio_appointments(client_id);
