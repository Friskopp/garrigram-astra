CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  caption TEXT NOT NULL,
  image TEXT NOT NULL,
  image_bytes INTEGER NOT NULL CHECK(image_bytes > 0),
  location TEXT,
  lat REAL,
  lng REAL,
  created_at TEXT NOT NULL,
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_posts_created ON posts(created_at DESC);
CREATE INDEX idx_posts_owner_created ON posts(owner_email, created_at);
CREATE TABLE likes (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  visitor TEXT NOT NULL,
  PRIMARY KEY(post_id, visitor)
);
CREATE TABLE storage_usage (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  bytes INTEGER NOT NULL DEFAULT 0 CHECK(bytes >= 0)
);
INSERT INTO storage_usage (id, bytes) VALUES (1, 0);
CREATE TRIGGER enforce_storage_budget BEFORE INSERT ON posts
WHEN (SELECT bytes FROM storage_usage WHERE id = 1) + NEW.image_bytes > 8000000000
BEGIN
  SELECT RAISE(ABORT, 'storage_budget_exceeded');
END;
CREATE TRIGGER enforce_daily_upload_limit BEFORE INSERT ON posts
WHEN (SELECT COUNT(*) FROM posts WHERE owner_email = NEW.owner_email AND created_at >= strftime('%Y-%m-%dT00:00:00.000Z', 'now')) >= 30
BEGIN
  SELECT RAISE(ABORT, 'daily_upload_limit_exceeded');
END;
CREATE TRIGGER track_photo_storage AFTER INSERT ON posts
BEGIN
  UPDATE storage_usage SET bytes = bytes + NEW.image_bytes WHERE id = 1;
END;
CREATE TRIGGER release_photo_storage AFTER DELETE ON posts
BEGIN
  UPDATE storage_usage SET bytes = bytes - OLD.image_bytes WHERE id = 1;
END;
