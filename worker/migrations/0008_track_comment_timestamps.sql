ALTER TABLE client_track_comments ADD COLUMN position_seconds INTEGER NOT NULL DEFAULT 0 CHECK (position_seconds >= 0);

CREATE INDEX client_track_comments_version_id ON client_track_comments(version_id, position_seconds, created_at);
