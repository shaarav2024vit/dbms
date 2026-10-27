-- =============================================================================
-- BCSE302L - Database Systems | Query Optimization & Indexing Benchmark
-- Project: Event and Ticket Booking System
-- Database: PostgreSQL 16
-- Authors: Kevin T John (24BYB0163), Govind B Nair (24BYB0101), Shaarav S (24BYB0118)
-- =============================================================================
--
-- This script benchmarks and proves query optimization using:
--   1. Partial B-Tree Indexes (Targeting high-frequency filtered subsets)
--   2. Multi-column Composite Indexes (Eliminating sorting overhead)
--   3. Covering Indexes with INCLUDE (Index-Only Scans avoiding Heap Fetches)
--
-- Run with:
--   psql -U postgres -d ticket_booking_system -f database/05_performance_benchmark.sql
-- =============================================================================

\timing on

-- Clean up any existing benchmark indexes
DROP INDEX IF EXISTS idx_booking_stale_pending;
DROP INDEX IF EXISTS idx_booking_user_id_desc;
DROP INDEX IF EXISTS idx_ticket_category_status_inc;
DROP INDEX IF EXISTS idx_event_date_venue;

-- =============================================================================
-- SCENARIO 1: PARTIAL INDEX FOR STALE BOOKING PURGE
-- Routine: sp_expire_stale_bookings (Nightly Administrative Background Job)
-- Objective: Filter only PENDING bookings older than 24 hours.
-- In production, 95%+ of bookings are CONFIRMED or CANCELLED. Indexing the
-- whole table wastes memory. A PARTIAL INDEX only indexes rows where status = 'PENDING'.
-- =============================================================================

\echo '-------------------------------------------------------------------------'
\echo 'SCENARIO 1 [BEFORE]: Stale Booking Expiration Query without Partial Index'
\echo '-------------------------------------------------------------------------'
EXPLAIN (ANALYZE, BUFFERS, COSTS)
SELECT booking_id, user_id, booking_date, total_amount
FROM BOOKING
WHERE status = 'PENDING'
  AND booking_date < (CURRENT_TIMESTAMP - INTERVAL '24 hours');

-- Apply Optimization: Partial Index
CREATE INDEX idx_booking_stale_pending 
ON BOOKING(booking_date) 
WHERE status = 'PENDING';

\echo '-------------------------------------------------------------------------'
\echo 'SCENARIO 1 [AFTER]: With Partial Index idx_booking_stale_pending'
\echo '-------------------------------------------------------------------------'
EXPLAIN (ANALYZE, BUFFERS, COSTS)
SELECT booking_id, user_id, booking_date, total_amount
FROM BOOKING
WHERE status = 'PENDING'
  AND booking_date < (CURRENT_TIMESTAMP - INTERVAL '24 hours');


-- =============================================================================
-- SCENARIO 2: COMPOSITE INDEX ELIMINATING SORT OVERHEAD
-- Routine: Customer Ticket Wallet & Order History
-- Objective: Retrieve a specific customer's bookings sorted chronologically desc.
-- Without index: PostgreSQL performs a Sequential Scan + In-Memory Sort.
-- With Composite Index (user_id, booking_id DESC): Directly scans index in order.
-- =============================================================================

\echo '-------------------------------------------------------------------------'
\echo 'SCENARIO 2 [BEFORE]: Customer Booking History without Composite Index'
\echo '-------------------------------------------------------------------------'
EXPLAIN (ANALYZE, BUFFERS, COSTS)
SELECT booking_id, event_id, total_amount, status, booking_date
FROM BOOKING
WHERE user_id = 4
ORDER BY booking_id DESC;

-- Apply Optimization: Composite B-Tree Index with explicit DESC order
CREATE INDEX idx_booking_user_id_desc 
ON BOOKING(user_id, booking_id DESC);

\echo '-------------------------------------------------------------------------'
\echo 'SCENARIO 2 [AFTER]: With Composite Index idx_booking_user_id_desc'
\echo '-------------------------------------------------------------------------'
EXPLAIN (ANALYZE, BUFFERS, COSTS)
SELECT booking_id, event_id, total_amount, status, booking_date
FROM BOOKING
WHERE user_id = 4
ORDER BY booking_id DESC;


-- =============================================================================
-- SCENARIO 3: COVERING INDEX (INDEX-ONLY SCAN VIA INCLUDE CLAUSE)
-- Routine: Real-Time Seat Availability & Validation in sp_book_tickets
-- Objective: Check whether seats in a given category are VALID without reading
-- the underlying table pages (Heap).
-- =============================================================================

\echo '-------------------------------------------------------------------------'
\echo 'SCENARIO 3 [BEFORE]: Ticket Category Validation without Covering Index'
\echo '-------------------------------------------------------------------------'
EXPLAIN (ANALYZE, BUFFERS, COSTS)
SELECT seat_number, status
FROM TICKET
WHERE category_id = 2 
  AND status = 'VALID';

-- Apply Optimization: Covering Index using INCLUDE
CREATE INDEX idx_ticket_category_status_inc 
ON TICKET(category_id, status) 
INCLUDE (seat_number);

-- Update statistics for Index-Only scan eligibility
VACUUM ANALYZE TICKET;

\echo '-------------------------------------------------------------------------'
\echo 'SCENARIO 3 [AFTER]: With Covering Index (Index-Only Scan, 0 Heap Fetches)'
\echo '-------------------------------------------------------------------------'
EXPLAIN (ANALYZE, BUFFERS, COSTS)
SELECT seat_number, status
FROM TICKET
WHERE category_id = 2 
  AND status = 'VALID';


-- =============================================================================
-- SCENARIO 4: COMPOSITE INDEX FOR EVENT CHRONOLOGY AND VENUE
-- Routine: Public Event Catalog Filtering
-- Objective: Filter events in a date window with venue details.
-- =============================================================================

\echo '-------------------------------------------------------------------------'
\echo 'SCENARIO 4 [BEFORE]: Date Range Query without Event Date Index'
\echo '-------------------------------------------------------------------------'
EXPLAIN (ANALYZE, BUFFERS, COSTS)
SELECT event_id, event_name, venue_id, event_date
FROM EVENT
WHERE event_date BETWEEN '2026-11-01' AND '2026-12-31'
ORDER BY event_date ASC;

-- Apply Optimization: Composite Index on event_date and venue_id
CREATE INDEX idx_event_date_venue 
ON EVENT(event_date ASC, venue_id);

\echo '-------------------------------------------------------------------------'
\echo 'SCENARIO 4 [AFTER]: With Composite Index idx_event_date_venue'
\echo '-------------------------------------------------------------------------'
EXPLAIN (ANALYZE, BUFFERS, COSTS)
SELECT event_id, event_name, venue_id, event_date
FROM EVENT
WHERE event_date BETWEEN '2026-11-01' AND '2026-12-31'
ORDER BY event_date ASC;

\echo '========================================================================='
\echo 'BENCHMARK COMPLETE: All 4 Index Optimization Scenarios Executed.'
\echo '========================================================================='
