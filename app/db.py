"""
Event and Ticket Booking System - Database Layer
Wraps PostgreSQL 16 connections, stored procedures, functions, cursors, and triggers.
Authors: Kevin T John, Govind B Nair, Shaarav S
"""

import os
import psycopg2
from psycopg2.extras import RealDictCursor

DB_HOST = os.getenv("PGHOST", "localhost")
DB_PORT = int(os.getenv("PGPORT", "5432"))
DB_NAME = os.getenv("PGDATABASE", "ticket_booking_system")
DB_USER = os.getenv("PGUSER", "postgres")
DB_PASS = os.getenv("PGPASSWORD", "postgrespassword")

def get_connection():
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASS
    )

def test_connection():
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version();")
                version = cur.fetchone()[0]
                return True, version
    except Exception as e:
        return False, str(e)

def get_overview_stats():
    tables = [
        "VENUE", "USERS", "EVENT", "SEAT_CATEGORY",
        "BOOKING", "TICKET", "PAYMENT", "CANCELLATION"
    ]
    stats = {}
    with get_connection() as conn:
        with conn.cursor() as cur:
            for tbl in tables:
                cur.execute(f"SELECT COUNT(*) FROM {tbl};")
                stats[tbl.lower()] = cur.fetchone()[0]
            
            cur.execute("SELECT COALESCE(SUM(amount_paid), 0) FROM PAYMENT WHERE status = 'SUCCESS';")
            stats["total_revenue"] = float(cur.fetchone()[0])
            
            cur.execute("SELECT COUNT(*) FROM BOOKING WHERE status = 'CONFIRMED';")
            stats["confirmed_bookings"] = cur.fetchone()[0]
    return stats

def get_users_list():
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT user_id, name, email, phone, role FROM USERS ORDER BY user_id ASC;")
            return cur.fetchall()

def get_public_catalog():
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM v_public_event_catalog ORDER BY event_date ASC, event_time ASC;")
            return cur.fetchall()

def get_event_categories(event_id):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT category_id, category_name, price, total_seats, available_seats
                FROM SEAT_CATEGORY
                WHERE event_id = %s
                ORDER BY price DESC;
            """, (event_id,))
            return cur.fetchall()

def get_category_seat_map(category_id):
    """
    Returns category seating details and all currently occupied seats (VALID / USED).
    Used by the 2D Interactive Visual Seat Map.
    """
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT sc.category_id, sc.event_id, sc.category_name, sc.price,
                       sc.total_seats, sc.available_seats,
                       e.event_name, e.event_date
                FROM SEAT_CATEGORY sc
                JOIN EVENT e ON sc.event_id = e.event_id
                WHERE sc.category_id = %s;
            """, (category_id,))
            cat = cur.fetchone()
            if not cat:
                return None

            cur.execute("""
                SELECT seat_number, status
                FROM TICKET
                WHERE category_id = %s AND status IN ('VALID', 'USED')
                ORDER BY seat_number ASC;
            """, (category_id,))
            tickets = cur.fetchall()
            cat["booked_seats"] = [t["seat_number"] for t in tickets]
            return cat


def get_event_details(event_id):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT e.*, v.venue_name, v.location, v.capacity AS venue_capacity,
                       u.name AS organizer_name,
                       fn_event_occupancy(e.event_id) AS occupancy_pct
                FROM EVENT e
                JOIN VENUE v ON e.venue_id = v.venue_id
                JOIN USERS u ON e.organizer_id = u.user_id
                WHERE e.event_id = %s;
            """, (event_id,))
            return cur.fetchone()

def get_user_wallet(user_id):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT * FROM v_customer_ticket_wallet
                WHERE user_id = %s
                ORDER BY booking_id DESC, ticket_id ASC;
            """, (user_id,))
            return cur.fetchall()

def get_user_bookings(user_id):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT b.booking_id, b.event_id, b.booking_date, b.total_amount, b.status,
                       e.event_name, e.event_date, e.event_time, v.venue_name,
                       COUNT(t.ticket_id) AS ticket_count,
                       c.status AS cancellation_status, c.refund_amount
                FROM BOOKING b
                JOIN EVENT e ON b.event_id = e.event_id
                JOIN VENUE v ON e.venue_id = v.venue_id
                LEFT JOIN TICKET t ON b.booking_id = t.booking_id
                LEFT JOIN CANCELLATION c ON b.booking_id = c.booking_id
                WHERE b.user_id = %s
                GROUP BY b.booking_id, b.event_id, b.booking_date, b.total_amount, b.status,
                         e.event_name, e.event_date, e.event_time, v.venue_name, c.status, c.refund_amount
                ORDER BY b.booking_id DESC;
            """, (user_id,))
            return cur.fetchall()

def get_booking_details(booking_id):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT b.*, e.event_name, e.event_date, e.event_time, v.venue_name, u.name AS customer_name
                FROM BOOKING b
                JOIN EVENT e ON b.event_id = e.event_id
                JOIN VENUE v ON e.venue_id = v.venue_id
                JOIN USERS u ON b.user_id = u.user_id
                WHERE b.booking_id = %s;
            """, (booking_id,))
            booking = cur.fetchone()
            if not booking:
                return None
            
            cur.execute("""
                SELECT t.ticket_id, t.seat_number, t.price, t.status, sc.category_name
                FROM TICKET t
                JOIN SEAT_CATEGORY sc ON t.category_id = sc.category_id
                WHERE t.booking_id = %s
                ORDER BY t.ticket_id ASC;
            """, (booking_id,))
            booking["tickets"] = cur.fetchall()

            cur.execute("""
                SELECT payment_id, payment_date, amount_paid, payment_method, status
                FROM PAYMENT
                WHERE booking_id = %s
                ORDER BY payment_id ASC;
            """, (booking_id,))
            booking["payments"] = cur.fetchall()

            cur.execute("""
                SELECT cancel_id, cancel_date, reason, refund_amount, status
                FROM CANCELLATION
                WHERE booking_id = %s;
            """, (booking_id,))
            booking["cancellation"] = cur.fetchone()

            return booking

def book_tickets(user_id, category_id, seats_list):
    """
    Executes Procedure: sp_book_tickets(p_user_id, p_category_id, p_seats, p_booking_id)
    Fires triggers: trg_ticket_validate, trg_ticket_inventory
    """
    with get_connection() as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("""
                CALL sp_book_tickets(%s, %s, %s, %s);
            """, (user_id, category_id, seats_list, None))
            
            # Fetch the generated booking id
            cur.execute("SELECT MAX(booking_id) FROM BOOKING WHERE user_id = %s;", (user_id,))
            booking_id = cur.fetchone()[0]
            
            # Get notices captured
            notices = [n.strip() for n in conn.notices]
            return booking_id, notices

def make_payment(booking_id, payment_method, simulate_success=True):
    """
    Executes Procedure: sp_make_payment(p_booking_id, p_payment_method, p_simulate_success)
    Fires trigger: trg_payment_confirm_booking (if success)
    """
    with get_connection() as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("""
                CALL sp_make_payment(%s, %s, %s);
            """, (booking_id, payment_method, simulate_success))
            notices = [n.strip() for n in conn.notices]
            return True, notices

def get_refund_quote(booking_id):
    """
    Executes Business Function: fn_calculate_refund(p_booking_id)
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT fn_calculate_refund(%s);", (booking_id,))
            return float(cur.fetchone()[0])

def cancel_booking(booking_id, reason):
    """
    Executes Procedure: sp_cancel_booking(p_booking_id, p_reason)
    Invokes fn_calculate_refund, fires trg_ticket_inventory (restores seats)
    """
    with get_connection() as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("CALL sp_cancel_booking(%s, %s);", (booking_id, reason))
            notices = [n.strip() for n in conn.notices]
            return True, notices

def get_organizer_events(organizer_id):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT e.event_id, e.event_name, e.event_date, e.event_time,
                       v.venue_name, v.capacity AS venue_capacity,
                       fn_event_occupancy(e.event_id) AS occupancy_pct,
                       COALESCE(SUM(sc.total_seats), 0) AS total_allocated_seats,
                       COALESCE(SUM(sc.available_seats), 0) AS remaining_seats
                FROM EVENT e
                JOIN VENUE v ON e.venue_id = v.venue_id
                LEFT JOIN SEAT_CATEGORY sc ON e.event_id = sc.event_id
                WHERE e.organizer_id = %s
                GROUP BY e.event_id, e.event_name, e.event_date, e.event_time, v.venue_name, v.capacity
                ORDER BY e.event_date ASC;
            """, (organizer_id,))
            return cur.fetchall()

def add_seat_category(event_id, category_name, price, total_seats):
    """
    Fires trigger: trg_category_capacity
    Raises exception if event total seats exceed venue capacity.
    """
    with get_connection() as conn:
        conn.autocommit = True
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                INSERT INTO SEAT_CATEGORY (event_id, category_name, price, total_seats, available_seats)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING category_id, category_name, price, total_seats, available_seats;
            """, (event_id, category_name, price, total_seats, total_seats))
            return cur.fetchone()

def run_settle_cancellations():
    return run_settle_approved_cancellations()

def run_settle_approved_cancellations():
    """
    Executes Cursor Procedure: sp_settle_approved_cancellations()
    Explicit cursor FOR UPDATE OF c with WHERE CURRENT OF.
    """
    with get_connection() as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("CALL sp_settle_approved_cancellations();")
            notices = [n.strip() for n in conn.notices]
            return notices

def run_expire_stale_bookings(hours=24):
    """
    Executes Cursor Procedure: sp_expire_stale_bookings(p_hold)
    Parameterized cursor.
    """
    with get_connection() as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute(f"CALL sp_expire_stale_bookings(INTERVAL '{hours} hours');")
            notices = [n.strip() for n in conn.notices]
            return notices

def get_customer_spend_report():
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT u.user_id, u.name, u.email, u.phone,
                       fn_customer_lifetime_spend(u.user_id) AS lifetime_spend,
                       COUNT(DISTINCT b.booking_id) AS total_bookings
                FROM USERS u
                LEFT JOIN BOOKING b ON u.user_id = b.user_id
                WHERE u.role = 'CUSTOMER'
                GROUP BY u.user_id, u.name, u.email, u.phone
                ORDER BY lifetime_spend DESC;
            """)
            return cur.fetchall()

def run_query(query_num):
    queries = {
        "1.1": ("Upcoming Events (Nov-Dec 2026)", """
            SELECT event_id, event_name, event_date, event_time, description
            FROM EVENT
            WHERE event_date BETWEEN '2026-11-01' AND '2026-12-31'
            ORDER BY event_date ASC, event_time ASC;
        """),
        "1.2": ("Standard Email Accounts (@gmail.com)", """
            SELECT user_id, name, email, phone, role
            FROM USERS
            WHERE email LIKE '%@gmail.com'
            ORDER BY name ASC;
        """),
        "1.3": ("High-Capacity Venues (>= 2000)", """
            SELECT venue_id, venue_name, location, capacity
            FROM VENUE
            WHERE capacity >= 2000
            ORDER BY capacity DESC;
        """),
        "2.1": ("Detailed Booking Receipts (4-Table Join)", """
            SELECT b.booking_id, u.name AS customer_name, u.email AS customer_email,
                   e.event_name, e.event_date, v.venue_name, b.total_amount, b.status AS booking_status
            FROM BOOKING b
            JOIN USERS u ON b.user_id = u.user_id
            JOIN EVENT e ON b.event_id = e.event_id
            JOIN VENUE v ON e.venue_id = v.venue_id
            ORDER BY b.booking_id ASC;
        """),
        "2.2": ("Venues and Scheduled Events (Left Join)", """
            SELECT v.venue_id, v.venue_name, v.location, v.capacity,
                   COALESCE(e.event_name, '--- No Scheduled Event ---') AS scheduled_event,
                   e.event_date
            FROM VENUE v
            LEFT JOIN EVENT e ON v.venue_id = e.venue_id
            ORDER BY v.venue_id, e.event_date;
        """),
        "2.3": ("Comprehensive Ticket Breakdown (5-Table Join)", """
            SELECT t.ticket_id, b.booking_id, u.name AS attendee_name, e.event_name,
                   sc.category_name AS seat_tier, t.seat_number, t.price AS ticket_price,
                   t.status AS ticket_status, v.venue_name
            FROM TICKET t
            JOIN BOOKING b ON t.booking_id = b.booking_id
            JOIN USERS u ON b.user_id = u.user_id
            JOIN SEAT_CATEGORY sc ON t.category_id = sc.category_id
            JOIN EVENT e ON sc.event_id = e.event_id
            JOIN VENUE v ON e.venue_id = v.venue_id
            ORDER BY t.ticket_id ASC;
        """),
        "3.1": ("Event Gross Sales & Average Price", """
            SELECT e.event_id, e.event_name,
                   COUNT(t.ticket_id) AS total_tickets_issued,
                   COALESCE(SUM(t.price), 0.00) AS gross_ticket_sales,
                   COALESCE(ROUND(AVG(t.price), 2), 0.00) AS avg_ticket_price
            FROM EVENT e
            LEFT JOIN SEAT_CATEGORY sc ON e.event_id = sc.event_id
            LEFT JOIN TICKET t ON sc.category_id = t.category_id AND t.status = 'VALID'
            GROUP BY e.event_id, e.event_name
            ORDER BY gross_ticket_sales DESC;
        """),
        "3.2": ("Active Organizers (> 1 event)", """
            SELECT u.user_id AS organizer_id, u.name AS organizer_name, u.email,
                   COUNT(e.event_id) AS total_events_organized
            FROM USERS u
            JOIN EVENT e ON u.user_id = e.organizer_id
            WHERE u.role = 'ORGANIZER'
            GROUP BY u.user_id, u.name, u.email
            HAVING COUNT(e.event_id) > 1;
        """),
        "3.3": ("Payment Method Financial Breakdown", """
            SELECT p.payment_method,
                   COUNT(p.payment_id) AS total_transactions,
                   SUM(CASE WHEN p.status = 'SUCCESS' THEN p.amount_paid ELSE 0 END) AS successful_amount,
                   COUNT(CASE WHEN p.status = 'FAILED' THEN 1 END) AS failed_attempts
            FROM PAYMENT p
            GROUP BY p.payment_method
            ORDER BY successful_amount DESC;
        """),
        "4.1": ("Categories Priced Higher Than Average", """
            SELECT sc.category_id, e.event_name, sc.category_name, sc.price
            FROM SEAT_CATEGORY sc
            JOIN EVENT e ON sc.event_id = e.event_id
            WHERE sc.price > (SELECT AVG(price) FROM SEAT_CATEGORY)
            ORDER BY sc.price DESC;
        """),
        "4.3": ("Customers with Zero Cancellations (NOT EXISTS)", """
            SELECT u.user_id, u.name, u.email
            FROM USERS u
            WHERE u.role = 'CUSTOMER'
              AND NOT EXISTS (
                  SELECT 1 FROM BOOKING b
                  JOIN CANCELLATION c ON b.booking_id = c.booking_id
                  WHERE b.user_id = u.user_id
              );
        """),
        "5.1": ("Event Gross Revenue Ranking (DENSE_RANK)", """
            SELECT e.event_name, v.venue_name,
                   COALESCE(SUM(b.total_amount), 0) AS total_revenue,
                   DENSE_RANK() OVER (ORDER BY COALESCE(SUM(b.total_amount), 0) DESC) AS revenue_rank
            FROM EVENT e
            JOIN VENUE v ON e.venue_id = v.venue_id
            LEFT JOIN BOOKING b ON e.event_id = b.event_id AND b.status = 'CONFIRMED'
            GROUP BY e.event_id, e.event_name, v.venue_name;
        """),
        "5.2": ("Cumulative Revenue Progression (Running Total)", """
            SELECT b.booking_id, b.booking_date, u.name AS customer_name, b.total_amount,
                   ROW_NUMBER() OVER (ORDER BY b.booking_date) AS booking_sequence,
                   SUM(b.total_amount) OVER (ORDER BY b.booking_date ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cumulative_revenue
            FROM BOOKING b
            JOIN USERS u ON b.user_id = u.user_id
            WHERE b.status = 'CONFIRMED'
            ORDER BY b.booking_date;
        """)
    }

    if query_num not in queries:
        return None, None, []
    
    title, sql = queries[query_num]
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql)
            results = cur.fetchall()
            return title, sql.strip(), results


def get_event_atlas_data(event_id):
    """
    Retrieves the complete relational topology centered on an EVENT anchor:
    - EVENT (with venue & organizer)
    - VENUE (physical constraints)
    - ORGANIZER (user account)
    - SEAT_CATEGORY (pricing tiers & quotas)
    - BOOKINGS (customer reservations)
      - CUSTOMER details
      - TICKETS issued (linked to SEAT_CATEGORY)
      - PAYMENTS attempted
      - CANCELLATION (optional 1:0..1)
    """
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT e.event_id, e.event_name, e.event_date, e.event_time, e.description, e.created_at,
                       v.venue_id, v.venue_name, v.location, v.capacity AS venue_capacity,
                       u.user_id AS organizer_id, u.name AS organizer_name, u.email AS organizer_email, u.phone AS organizer_phone,
                       fn_event_occupancy(e.event_id) AS occupancy_pct
                FROM EVENT e
                JOIN VENUE v ON e.venue_id = v.venue_id
                JOIN USERS u ON e.organizer_id = u.user_id
                WHERE e.event_id = %s;
            """, (event_id,))
            event_row = cur.fetchone()
            if not event_row:
                return None

            event = {
                "event_id": event_row["event_id"],
                "event_name": event_row["event_name"],
                "event_date": event_row["event_date"],
                "event_time": event_row["event_time"],
                "description": event_row["description"],
                "created_at": event_row["created_at"],
                "occupancy_pct": float(event_row["occupancy_pct"] or 0)
            }

            venue = {
                "venue_id": event_row["venue_id"],
                "venue_name": event_row["venue_name"],
                "location": event_row["location"],
                "capacity": event_row["venue_capacity"]
            }

            organizer = {
                "user_id": event_row["organizer_id"],
                "name": event_row["organizer_name"],
                "email": event_row["organizer_email"],
                "phone": event_row["organizer_phone"],
                "role": "ORGANIZER"
            }

            cur.execute("""
                SELECT category_id, event_id, category_name, price, total_seats, available_seats,
                       (total_seats - available_seats) AS booked_count
                FROM SEAT_CATEGORY
                WHERE event_id = %s
                ORDER BY price DESC;
            """, (event_id,))
            categories = cur.fetchall()

            cur.execute("""
                SELECT b.booking_id, b.event_id, b.user_id, b.booking_date, b.total_amount, b.status,
                       u.name AS customer_name, u.email AS customer_email, u.phone AS customer_phone
                FROM BOOKING b
                JOIN USERS u ON b.user_id = u.user_id
                WHERE b.event_id = %s
                ORDER BY b.booking_id ASC;
            """, (event_id,))
            bookings = cur.fetchall()

            booking_ids = [b["booking_id"] for b in bookings]
            tickets_by_booking = {}
            payments_by_booking = {}
            cancellations_by_booking = {}

            if booking_ids:
                cur.execute("""
                    SELECT t.ticket_id, t.booking_id, t.category_id, t.seat_number, t.price, t.status,
                           sc.category_name
                    FROM TICKET t
                    JOIN SEAT_CATEGORY sc ON t.category_id = sc.category_id
                    WHERE t.booking_id = ANY(%s)
                    ORDER BY t.ticket_id ASC;
                """, (booking_ids,))
                for t in cur.fetchall():
                    tickets_by_booking.setdefault(t["booking_id"], []).append(t)

                cur.execute("""
                    SELECT payment_id, booking_id, payment_date, amount_paid, payment_method, status
                    FROM PAYMENT
                    WHERE booking_id = ANY(%s)
                    ORDER BY payment_id ASC;
                """, (booking_ids,))
                for p in cur.fetchall():
                    payments_by_booking.setdefault(p["booking_id"], []).append(p)

                cur.execute("""
                    SELECT cancel_id, booking_id, cancel_date, reason, refund_amount, status
                    FROM CANCELLATION
                    WHERE booking_id = ANY(%s);
                """, (booking_ids,))
                for c in cur.fetchall():
                    cancellations_by_booking[c["booking_id"]] = c

            for b in bookings:
                bid = b["booking_id"]
                b["tickets"] = tickets_by_booking.get(bid, [])
                b["payments"] = payments_by_booking.get(bid, [])
                b["cancellation"] = cancellations_by_booking.get(bid, None)

            return {
                "event": event,
                "venue": venue,
                "organizer": organizer,
                "categories": categories,
                "bookings": bookings
            }
