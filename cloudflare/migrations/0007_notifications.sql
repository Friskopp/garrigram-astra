CREATE TABLE push_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_push_events_time ON push_events(created_at);
CREATE TRIGGER enqueue_photo_notification AFTER INSERT ON posts
WHEN NEW.demo=0
BEGIN
  INSERT INTO push_events(post_id,created_at) VALUES(NEW.id,CAST(unixepoch('subsec')*1000 AS INTEGER));
END;
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_sent INTEGER NOT NULL DEFAULT 0,
  test_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_push_owner ON push_subscriptions(owner_id);
CREATE TRIGGER limit_push_devices BEFORE INSERT ON push_subscriptions
WHEN NOT EXISTS(SELECT 1 FROM push_subscriptions WHERE endpoint=NEW.endpoint)
  AND (SELECT COUNT(*) FROM push_subscriptions WHERE owner_id=NEW.owner_id)>=10
BEGIN
  SELECT RAISE(ABORT,'too_many_devices');
END;
