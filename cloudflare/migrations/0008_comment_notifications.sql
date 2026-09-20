ALTER TABLE push_subscriptions ADD COLUMN photos_enabled INTEGER NOT NULL DEFAULT 1 CHECK(photos_enabled IN (0,1));
ALTER TABLE push_subscriptions ADD COLUMN comments_enabled INTEGER NOT NULL DEFAULT 0 CHECK(comments_enabled IN (0,1));
ALTER TABLE push_subscriptions ADD COLUMN comment_cursor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE push_subscriptions ADD COLUMN comment_last_sent INTEGER NOT NULL DEFAULT 0;
CREATE TABLE push_comment_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL UNIQUE REFERENCES comments(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_push_comment_events_time ON push_comment_events(created_at);
CREATE TRIGGER enqueue_comment_notification AFTER INSERT ON comments
WHEN EXISTS(SELECT 1 FROM posts p WHERE p.id=NEW.post_id AND p.demo=0 AND p.owner_email!=NEW.owner_email)
BEGIN
  INSERT INTO push_comment_events(comment_id,created_at) VALUES(NEW.id,CAST(unixepoch('subsec')*1000 AS INTEGER));
END;
