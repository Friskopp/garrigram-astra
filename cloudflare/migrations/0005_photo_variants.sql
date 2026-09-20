CREATE TABLE photo_variants (
  object_key TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  bytes INTEGER NOT NULL CHECK(bytes > 0)
);
CREATE INDEX idx_photo_variants_post ON photo_variants(post_id);
CREATE TRIGGER enforce_variant_storage_budget BEFORE INSERT ON photo_variants
WHEN (SELECT bytes FROM storage_usage WHERE id=1) + NEW.bytes > 8000000000
BEGIN
  SELECT RAISE(ABORT, 'storage_budget_exceeded');
END;
CREATE TRIGGER track_variant_storage AFTER INSERT ON photo_variants
BEGIN
  UPDATE storage_usage SET bytes = bytes + NEW.bytes WHERE id=1;
END;
CREATE TRIGGER release_variant_storage AFTER DELETE ON photo_variants
BEGIN
  UPDATE storage_usage SET bytes = bytes - OLD.bytes WHERE id=1;
END;
