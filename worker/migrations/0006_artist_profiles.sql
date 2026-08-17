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
