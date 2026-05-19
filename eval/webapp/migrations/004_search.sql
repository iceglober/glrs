ALTER TABLE posts ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;

CREATE INDEX IF NOT EXISTS posts_search_vector_gin ON posts USING GIN (search_vector);

CREATE OR REPLACE FUNCTION posts_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.body, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS posts_search_vector_trigger ON posts;
CREATE TRIGGER posts_search_vector_trigger
  BEFORE INSERT OR UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION posts_search_vector_update();

UPDATE posts
SET search_vector = to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(body, ''))
WHERE search_vector IS NULL;
