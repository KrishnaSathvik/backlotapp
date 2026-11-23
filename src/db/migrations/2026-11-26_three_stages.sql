-- Three stages in the product: Planned (idea), Made (ready), Posted (posted).
-- Older rows saved as scripting or editing are Planned. Safe to run more than once.
UPDATE content_items SET status = 'idea' WHERE status IN ('scripting', 'editing');

-- Rollback:
-- This rewrite cannot be undone: scripting and editing are not stored separately anymore.
