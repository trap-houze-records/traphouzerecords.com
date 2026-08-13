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
