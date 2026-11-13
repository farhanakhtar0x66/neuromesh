Expand-contract, in phases, so the old service version keeps working during the rolling deploy.

Phase 1 (expand): ALTER TABLE customers ADD COLUMN street text, ADD COLUMN city text, ADD COLUMN state text, ADD COLUMN pincode text; (nullable, metadata-only)
Phase 2: CREATE OR REPLACE TRIGGER split_address BEFORE INSERT OR UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION split_address(); deploy app dual-write.
Phase 3: batched backfill: UPDATE customers SET ... WHERE id IN (SELECT id FROM customers WHERE street IS NULL ORDER BY id LIMIT 5000 FOR UPDATE SKIP LOCKED);
Phase 4: switch reads to the new columns in the app.
Phase 5 (contract): once no old version remains, ALTER TABLE customers DROP COLUMN full_address;
