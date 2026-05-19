ALTER TABLE posts ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;

CREATE INDEX IF NOT EXISTS posts_search_vector_idx ON posts USING GIN(search_vector);

CREATE OR REPLACE FUNCTION posts_search_vector_update()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', NEW.title || ' ' || NEW.body);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS posts_search_vector_trigger ON posts;

CREATE TRIGGER posts_search_vector_trigger
  BEFORE INSERT OR UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION posts_search_vector_update();

UPDATE posts SET search_vector = to_tsvector('english', title || ' ' || body);
