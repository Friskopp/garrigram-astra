CREATE TABLE profiles (
  owner_id TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  avatar TEXT,
  avatar_bytes INTEGER NOT NULL DEFAULT 0 CHECK(avatar_bytes BETWEEN 0 AND 524288)
);
CREATE TRIGGER profile_storage_limit BEFORE UPDATE OF avatar_bytes ON profiles
WHEN (SELECT bytes FROM storage_usage WHERE id=1) - OLD.avatar_bytes + NEW.avatar_bytes > 8000000000
BEGIN
  SELECT RAISE(ABORT, 'storage_budget_exceeded');
END;
CREATE TRIGGER profile_storage_update AFTER UPDATE OF avatar_bytes ON profiles
BEGIN
  UPDATE storage_usage SET bytes=bytes-OLD.avatar_bytes+NEW.avatar_bytes WHERE id=1;
END;
CREATE TABLE check_ins (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  lat REAL NOT NULL CHECK(lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK(lng BETWEEN -180 AND 180),
  message TEXT NOT NULL DEFAULT '',
  shared_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_check_ins_expiry ON check_ins(expires_at);
CREATE TABLE location_requests (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_location_requests_sender ON location_requests(profile_id,created_at);
CREATE INDEX idx_location_requests_expiry ON location_requests(expires_at);
CREATE TABLE request_dismissals (
  request_id TEXT NOT NULL REFERENCES location_requests(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY(request_id,profile_id)
);
