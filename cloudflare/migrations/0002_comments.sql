CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_comments_post ON comments(post_id, id DESC);
