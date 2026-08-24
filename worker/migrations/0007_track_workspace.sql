ALTER TABLE client_tracks ADD COLUMN category TEXT NOT NULL DEFAULT 'mix-master' CHECK (category IN ('mix-master', 'recording'));
ALTER TABLE client_tracks ADD COLUMN requested_service TEXT;
ALTER TABLE client_tracks ADD COLUMN source_track_id TEXT;

CREATE TABLE client_track_versions (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES client_tracks(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  created_by TEXT NOT NULL CHECK (created_by IN ('client', 'admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX client_track_versions_track_id ON client_track_versions(track_id, created_at DESC);

CREATE TABLE client_track_comments (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES client_tracks(id) ON DELETE CASCADE,
  version_id TEXT REFERENCES client_track_versions(id) ON DELETE SET NULL,
  author_type TEXT NOT NULL CHECK (author_type IN ('client', 'admin')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX client_track_comments_track_id ON client_track_comments(track_id, created_at DESC);
