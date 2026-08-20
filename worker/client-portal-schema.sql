-- Esquema local de preparação para a Área do Cliente.
-- Não executar nem publicar sem criar a base D1 e configurar o Worker.

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE client_sessions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX client_sessions_client_id ON client_sessions(client_id);
CREATE INDEX client_sessions_expires_at ON client_sessions(expires_at);

CREATE TABLE client_tracks (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('start', 'mix', 'master')),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid')),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0 AND paid_cents <= amount_cents),
  payment_url TEXT,
  samply_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX client_tracks_client_id ON client_tracks(client_id);

CREATE TABLE client_bookings (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  starts_at TEXT,
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid')),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0 AND paid_cents <= amount_cents),
  payment_url TEXT,
  appointment_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX client_bookings_client_id ON client_bookings(client_id);

CREATE TABLE studio_appointments (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  guest_name TEXT,
  guest_phone TEXT,
  guest_email TEXT,
  service TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid')),
  payment_url TEXT,
  paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_cents >= 0 AND paid_cents <= amount_cents),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_at > starts_at),
  CHECK (client_id IS NOT NULL OR guest_name IS NOT NULL)
);

CREATE INDEX studio_appointments_starts_at ON studio_appointments(starts_at);
CREATE INDEX studio_appointments_client_id ON studio_appointments(client_id);
CREATE UNIQUE INDEX client_bookings_appointment_unique ON client_bookings(appointment_id) WHERE appointment_id IS NOT NULL;

CREATE TABLE google_calendar_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  calendar_id TEXT,
  calendar_name TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE studio_appointments ADD COLUMN google_event_id TEXT;
CREATE UNIQUE INDEX studio_appointments_google_event_id ON studio_appointments(google_event_id) WHERE google_event_id IS NOT NULL;

CREATE TABLE client_audit_log (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE artist_profiles (
  client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  artist_name TEXT NOT NULL,
  image TEXT,
  bio TEXT,
  instagram TEXT,
  youtube TEXT,
  spotify TEXT,
  apple_music TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX artist_profiles_artist_name ON artist_profiles(artist_name COLLATE NOCASE);
