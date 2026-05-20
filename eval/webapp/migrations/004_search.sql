-- Add search_vector column for full-text search
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'posts' AND column_name = 'search_vector') THEN
    ALTER TABLE posts ADD COLUMN search_vector tsvector;
    -- Populate search_vector with existing data
    UPDATE posts SET search_vector = to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''));
  END IF;
END $$;

-- Create GIN index for full-text search performance
CREATE INDEX IF NOT EXISTS idx_posts_search_vector ON posts USING GIN(search_vector);

-- Trigger to update search_vector on insert/update
CREATE OR REPLACE FUNCTION update_posts_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.title, '') || ' ' || coalesce(NEW.body, ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_posts_search_vector ON posts;
CREATE TRIGGER trg_posts_search_vector
BEFORE INSERT OR UPDATE ON posts
FOR EACH ROW
EXECUTE FUNCTION update_posts_search_vector();
