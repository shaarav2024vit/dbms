# Event and Ticket Booking System

A full-stack relational database application managing venues, events, tiered seating, atomic reservations, multi-attempt payments, and policy-based cancellations. Built with PostgreSQL 16 (PL/pgSQL stored procedures, triggers, cursors) and an interactive Python application.

**Authors:**
- **Kevin T John** — Core Architecture, Venues, Users & Events
- **Govind B Nair** — Seating Categories, Ticket Inventory & Bookings
- **Shaarav S** — Payments, Cancellations & Advanced Analytics

**Database Engine:** PostgreSQL 16 (PL/pgSQL)  
**Backend & Driver:** Python 3, Flask, psycopg2  

---

## Project Structure

```
db project/
├── app/
│   ├── db.py                       # PostgreSQL 16 driver wrapper (psycopg2)
│   ├── server.py                   # Flask Web Server & REST API
│   ├── static/
│   │   ├── app.js                  # Client application logic & transaction inspector
│   │   └── style.css               # Clean dark-mode design system
│   └── templates/
│       └── index.html              # Interactive Web Dashboard
├── cli_app.py                      # Interactive Terminal CLI for shell demonstrations
├── database/
│   ├── 01_schema.sql               # DDL: 8 Tables, Primary Keys, Foreign Keys, CHECK constraints
│   ├── 02_seed_data.sql            # DML: Comprehensive dataset (10+ records per table)
│   ├── 03_review2_queries.sql      # Advanced SQL Queries (Joins, Aggregations, Subqueries, Views)
│   ├── 04_plsql.sql                # Stored Procedures, Functions, Cursors, and Triggers
│   └── demos/
│       ├── 06_dml_demo.sql         # DML operations & constraint verification demo
│       └── 07_transactions_demo.sql # 7 Real-World Transaction demo workflows
├── docs/
│   ├── BCSE302L_Review_I_Report.md  # Review I System Design Documentation
│   ├── BCSE302L_Review_II_Report.md # Review II Implementation Documentation
│   ├── BCSE302L_Review_III_Report.md# Review III Integrated System Documentation
│   └── Team_Presentation_Guide.md  # Team speaking script & table allocations
├── docker-compose.yml              # PostgreSQL 16 container service configuration
├── run_app.sh                      # Universal launcher for Web App and CLI (works in fish, bash, zsh)
├── run_db.sh                       # Automation script for start/stop/init/queries/demo/psql
└── venv/                           # Python virtual environment (psycopg2-binary, flask)
```

---

## Universal Quick Start (One Command for Any OS)

Works out-of-the-box on **macOS (Apple Silicon & Intel)**, **Arch Linux**, **CachyOS**, **EndeavourOS**, **Ubuntu**, **Debian**, and **Fedora**:

```bash
./start.sh
```
*Automatically sets up Python virtual environment, installs dependencies, starts PostgreSQL (Docker or native), initializes schema & seed data if needed, and opens http://localhost:5050 in your browser.*

---

## Manual Step-by-Step Commands

### 1. Database Setup
```bash
# Start PostgreSQL container
./run_db.sh start

# Apply schema, seed data, and PL/pgSQL routines
./run_db.sh init

# Run SQL query test suite
./run_db.sh queries

# Run DML & Transaction demo scripts
./run_db.sh demo

# Run 10-Thread Concurrency & Race Condition Stress Test
./run_db.sh race   # or ./run_app.sh race

# Run EXPLAIN ANALYZE Query Optimization & Index Benchmark
./run_db.sh benchmark   # or ./run_app.sh benchmark
```

### 2. Launch the Application

#### Option A: Web Dashboard (Browser)
```bash
./run_app.sh
```
*Open http://localhost:5050 in your browser.*

#### Option B: Terminal Interactive CLI
```bash
./run_app.sh cli
```

#### Option C: Direct PostgreSQL Prompt
```bash
./run_db.sh psql
```

---

## Database Connection Details
- **Host**: `localhost`
- **Port**: `5432`
- **Database Name**: `ticket_booking_system`
- **Username**: `postgres`
- **Password**: `postgrespassword`

---

## Database Schema & Table Overview

| # | Table | Primary Key | Foreign Key References | Key Constraints & Business Rules | Lead Member |
| :-: | :--- | :--- | :--- | :--- | :--- |
| 1 | `VENUE` | `venue_id` | — | `capacity > 0` | Kevin |
| 2 | `USERS` | `user_id` | — | `email UNIQUE`, `phone UNIQUE`, `role CHECK ('CUSTOMER', 'ORGANIZER', 'ADMIN')` | Kevin |
| 3 | `EVENT` | `event_id` | `venue_id → VENUE`<br>`organizer_id → USERS` | `ON DELETE RESTRICT` protects active events from accidental deletion | Kevin |
| 4 | `SEAT_CATEGORY` | `category_id` | `event_id → EVENT` | `ON DELETE CASCADE`, `price >= 0`, `0 <= available_seats <= total_seats` | Govind |
| 5 | `BOOKING` | `booking_id` | `event_id → EVENT`<br>`user_id → USERS` | `total_amount >= 0`, `status CHECK ('PENDING', 'CONFIRMED', 'CANCELLED')` | Govind |
| 6 | `TICKET` | `ticket_id` | `booking_id → BOOKING`<br>`category_id → SEAT_CATEGORY` | `UNIQUE(category_id, seat_number)` strictly prevents double-booking | Govind |
| 7 | `PAYMENT` | `payment_id` | `booking_id → BOOKING` | `amount_paid >= 0`, supports 1:N failed/retry payment attempts | Shaarav |
| 8 | `CANCELLATION` | `cancel_id` | `booking_id → BOOKING` | `booking_id UNIQUE` enforces 1:0..1 (prevents duplicate cancellations) | Shaarav |

---

## Real-World Business Transactions

1. **Atomic Multi-Seat Reservation (`sp_book_tickets`)**: Atomically reserves tickets in a selected seat category. Validates category match and dynamically computes total price via `trg_ticket_validate` while decrementing remaining seats via `trg_ticket_inventory`.
2. **Payment Lifecycle & Retries (`sp_make_payment`)**: Records failed or successful payments per booking. On success, `trg_payment_confirm_booking` automatically transitions booking from `PENDING` to `CONFIRMED`.
3. **Double-Booking Protection**: Enforced by composite constraint `UNIQUE(category_id, seat_number)`. Any concurrent or duplicate seat allocation immediately triggers an exception and rolls back the entire transaction.
4. **Venue Capacity Guard (`trg_category_capacity`)**: Trigger prevents organizers from defining seat category capacities that exceed the host venue's physical capacity.
5. **Policy-Based Cancellation (`sp_cancel_booking`)**: Computes time-decay refunds via `fn_calculate_refund` (100% for ≥14 days, 75% for 7–13 days, 50% for 2–6 days, 0% for <2 days), marks tickets as `CANCELLED`, and restores inventory via `trg_ticket_inventory`.
6. **Batch Cancellation Settlement Cursor (`sp_settle_approved_cancellations`)**: Nightly administrative job utilizing an explicit cursor with `FOR UPDATE OF c` and `WHERE CURRENT OF` to disburse refunds and settle approved cancellation requests in bulk.
7. **Stale Checkout Expiration Cursor (`sp_expire_stale_bookings`)**: Parameterized cursor identifying and cancelling unpaid pending reservations older than a configurable threshold (e.g. 24 hours), releasing seat holds automatically.
