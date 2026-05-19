ALTER TABLE posts ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;

CREATE INDEX IF NOT EXISTS idx_posts_search_vector ON posts USING GIN (search_vector);

CREATE OR REPLACE FUNCTION posts_search_vector_trigger()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.title, '') || ' ' || coalesce(NEW.body, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS posts_search_vector_tg ON posts;
CREATE TRIGGER posts_search_vector_tg
  BEFORE INSERT OR UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION posts_search_vector_trigger();

UPDATE posts SET search_vector = to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''));
