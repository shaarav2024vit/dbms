#!/usr/bin/env python3
"""
================================================================================
Event and Ticket Booking System - Concurrency & Race Condition Stress Test
BCSE302L - Database Systems | Review III Demonstration
Authors: Kevin T John, Govind B Nair, Shaarav S
================================================================================

DEMONSTRATES:
  1. Transaction Isolation & Atomicity in PostgreSQL 16.
  2. Proof that composite constraint UNIQUE(category_id, seat_number) prevents
     double-booking under high concurrent load.
  3. When 10 concurrent customer threads simultaneously attempt to reserve
     the EXACT SAME seat at the exact same microsecond:
     - EXACTLY 1 transaction succeeds and commits.
     - EXACTLY 9 transactions are rejected by the database and rolled back.
================================================================================
"""

import sys
import os
import time
import threading
from datetime import datetime
import argparse

# Add app directory to Python path for db helper
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    from db import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS, get_connection
except ImportError as e:
    print(f"[ERROR] Could not import psycopg2 or db module: {e}")
    sys.exit(1)

# ANSI Color Codes for terminal output
C_RESET = "\033[0m"
C_BOLD = "\033[1m"
C_GREEN = "\033[92m"
C_RED = "\033[91m"
C_YELLOW = "\033[93m"
C_CYAN = "\033[96m"
C_DIM = "\033[2m"
C_BG_GREEN = "\033[42m\033[30m"
C_BG_RED = "\033[41m\033[37m"

def print_banner():
    print(f"{C_CYAN}{'=' * 85}{C_RESET}")
    print(f"{C_BOLD}{C_YELLOW}  EVENT & TICKET BOOKING SYSTEM — CONCURRENCY & RACE CONDITION TEST{C_RESET}")
    print(f"{C_CYAN}  BCSE302L Database Systems | Transaction Isolation & ACID Verification{C_RESET}")
    print(f"{C_CYAN}{'=' * 85}{C_RESET}")

def prepare_test_environment(target_category_id, target_seat):
    """
    Cleans up any previous test booking for the target seat so tests are idempotent,
    and returns 10 customer user records.
    """
    conn = get_connection()
    conn.autocommit = True
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # 1. Check if category exists
            cur.execute("""
                SELECT sc.category_id, sc.category_name, sc.price, sc.available_seats,
                       e.event_id, e.event_name, e.event_date
                FROM SEAT_CATEGORY sc
                JOIN EVENT e ON sc.event_id = e.event_id
                WHERE sc.category_id = %s;
            """, (target_category_id,))
            cat = cur.fetchone()
            if not cat:
                raise ValueError(f"Category ID {target_category_id} not found in database.")

            # 2. Clean up any previous test booking that holds target_seat in this category
            cur.execute("""
                SELECT booking_id FROM TICKET
                WHERE category_id = %s AND seat_number = %s;
            """, (target_category_id, target_seat))
            existing = cur.fetchall()
            for row in existing:
                b_id = row["booking_id"]
                cur.execute("DELETE FROM TICKET WHERE booking_id = %s;", (b_id,))
                cur.execute("DELETE FROM PAYMENT WHERE booking_id = %s;", (b_id,))
                cur.execute("DELETE FROM CANCELLATION WHERE booking_id = %s;", (b_id,))
                cur.execute("DELETE FROM BOOKING WHERE booking_id = %s;", (b_id,))
                print(f"{C_DIM}[Setup] Cleaned up legacy test booking #{b_id} for seat '{target_seat}'.{C_RESET}")

            # 3. Fetch up to 10 distinct customer users
            cur.execute("""
                SELECT user_id, name, email FROM USERS
                WHERE role = 'CUSTOMER'
                ORDER BY user_id ASC
                LIMIT 10;
            """)
            customers = cur.fetchall()
            if len(customers) < 2:
                raise ValueError("Need at least 2 CUSTOMER users in USERS table to run race test.")

            return cat, customers
    finally:
        conn.close()

def book_seat_worker(thread_id, user, category_id, seat_number, barrier, results):
    """
    Worker thread that synchronizes on a barrier and calls sp_book_tickets concurrently.
    """
    # Each thread must open its own isolated database connection
    try:
        conn = get_connection()
        conn.autocommit = True
    except Exception as e:
        results[thread_id] = {
            "thread_id": thread_id,
            "user_id": user["user_id"],
            "user_name": user["name"],
            "success": False,
            "error_type": "ConnectionError",
            "message": str(e),
            "booking_id": None,
            "timestamp": datetime.now().strftime("%H:%M:%S.%f")[:-3]
        }
        return

    # Wait at the starting gate until all threads are ready
    try:
        barrier.wait(timeout=5)
    except threading.BrokenBarrierError:
        pass

    start_time = datetime.now()
    ts_str = start_time.strftime("%H:%M:%S.%f")[:-3]

    try:
        with conn.cursor() as cur:
            # Execute stored procedure sp_book_tickets
            cur.execute("""
                CALL sp_book_tickets(%s, %s, %s, %s);
            """, (user["user_id"], category_id, [seat_number], None))

            # Fetch the generated booking_id
            cur.execute("SELECT MAX(booking_id) FROM BOOKING WHERE user_id = %s;", (user["user_id"],))
            booking_id = cur.fetchone()[0]

            results[thread_id] = {
                "thread_id": thread_id,
                "user_id": user["user_id"],
                "user_name": user["name"],
                "success": True,
                "error_type": None,
                "message": f"Successfully reserved Seat {seat_number}",
                "booking_id": booking_id,
                "timestamp": ts_str
            }
    except Exception as e:
        err_msg = str(e).strip().split("\n")[0]
        # Shorten message for display
        if "uq_category_seat" in err_msg or "unique constraint" in err_msg.lower():
            err_type = "UNIQUE_VIOLATION"
            display_msg = "Double-booking blocked: UNIQUE(category_id, seat_number) violated"
        elif "Only 0 seat(s) left" in err_msg or "left in category" in err_msg:
            err_type = "INVENTORY_EXHAUSTED"
            display_msg = "Trigger/Validation: Category seat quota exhausted"
        else:
            err_type = "ROLLBACK"
            display_msg = err_msg[:75]

        results[thread_id] = {
            "thread_id": thread_id,
            "user_id": user["user_id"],
            "user_name": user["name"],
            "success": False,
            "error_type": err_type,
            "message": display_msg,
            "booking_id": None,
            "timestamp": ts_str
        }
    finally:
        conn.close()

def run_concurrency_test(category_id=1, seat_number="VIP-RACE-01", num_threads=10, auto_cleanup=False):
    print_banner()
    print(f"\n{C_BOLD}Test Parameters:{C_RESET}")
    print(f"  • Target Category ID : {C_CYAN}{category_id}{C_RESET}")
    print(f"  • Contested Seat     : {C_YELLOW}'{seat_number}'{C_RESET}")
    print(f"  • Concurrent Threads : {C_BOLD}{num_threads}{C_RESET}")

    # Prepare environment
    print(f"\n{C_DIM}Connecting to PostgreSQL 16 on {DB_HOST}:{DB_PORT} ...{C_RESET}")
    try:
        cat_info, customers = prepare_test_environment(category_id, seat_number)
    except Exception as e:
        print(f"{C_RED}[ERROR] Setup failed: {e}{C_RESET}")
        return

    print(f"  • Target Event       : {C_GREEN}{cat_info['event_name']}{C_RESET} ({cat_info['event_date']})")
    print(f"  • Category Tier      : {cat_info['category_name']} (₹{cat_info['price']})")
    print(f"  • Enrolled Customers : {len(customers)} simulated buyers ready")

    # If fewer customers than threads, cycle them
    active_customers = [customers[i % len(customers)] for i in range(num_threads)]

    barrier = threading.Barrier(num_threads)
    results = [None] * num_threads
    threads = []

    print(f"\n{C_BOLD}Spawning {num_threads} synchronized worker threads...{C_RESET}")
    for i in range(num_threads):
        t = threading.Thread(
            target=book_seat_worker,
            args=(i + 1, active_customers[i], category_id, seat_number, barrier, results)
        )
        threads.append(t)

    # Launch all threads
    start_wall = time.time()
    for t in threads:
        t.start()

    # Await completion
    for t in threads:
        t.join()
    elapsed = (time.time() - start_wall) * 1000

    print(f"\n{C_BOLD}Concurrent Execution Results (Wall Clock: {elapsed:.2f} ms):{C_RESET}")
    print(f"{C_DIM}{'─' * 95}{C_RESET}")
    print(f"{'Thread':<9} {'Time':<14} {'User':<22} {'Result':<14} {'PostgreSQL Response / Error'}")
    print(f"{C_DIM}{'─' * 95}{C_RESET}")

    successes = 0
    failures = 0
    winning_booking = None

    for r in results:
        tid = f"#{r['thread_id']}"
        ts = r["timestamp"]
        uname = f"{r['user_name'][:18]} (ID:{r['user_id']})"
        if r["success"]:
            successes += 1
            winning_booking = r["booking_id"]
            status_badge = f"{C_GREEN}{C_BOLD}✓ SUCCESS{C_RESET}"
            detail = f"{C_GREEN}BOOKING #{r['booking_id']} CREATED & COMMITTED{C_RESET}"
        else:
            failures += 1
            status_badge = f"{C_RED}✗ REJECTED{C_RESET}"
            detail = f"{C_DIM}{r['message']}{C_RESET}"
        print(f"{tid:<9} {ts:<14} {uname:<22} {status_badge:<23} {detail}")

    print(f"{C_DIM}{'─' * 95}{C_RESET}")

    # Summary Evaluation
    print(f"\n{C_BOLD}ACID INTEGRITY EVALUATION SUMMARY:{C_RESET}")
    print(f"  • Total Parallel Checkout Attempts : {C_BOLD}{num_threads}{C_RESET}")
    print(f"  • Successful Bookings Committed     : {C_GREEN}{C_BOLD}{successes}{C_RESET}")
    print(f"  • Double-Bookings Prevented         : {C_RED}{C_BOLD}{failures}{C_RESET}")
    print(f"  • Winning Booking Reference         : Booking #{winning_booking}")

    if successes == 1 and failures == (num_threads - 1):
        print(f"\n  {C_BG_GREEN} TEST PASSED — 100% DOUBLE-BOOKING IMMUNITY VERIFIED {C_RESET}")
        print(f"  {C_GREEN}PostgreSQL composite constraint `uq_category_seat UNIQUE(category_id, seat_number)`{C_RESET}")
        print(f"  {C_GREEN}successfully isolated transactions and prevented race conditions.{C_RESET}")
    else:
        print(f"\n  {C_BG_RED} TEST ANOMALY DETECTED {C_RESET}")
        print(f"  Expected 1 success, but got {successes}.")

    # Optional Cleanup
    if auto_cleanup and winning_booking:
        conn = get_connection()
        conn.autocommit = True
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM TICKET WHERE booking_id = %s;", (winning_booking,))
                cur.execute("DELETE FROM BOOKING WHERE booking_id = %s;", (winning_booking,))
            print(f"\n{C_DIM}[Cleanup] Automatically removed test booking #{winning_booking}.{C_RESET}")
        finally:
            conn.close()
    elif winning_booking:
        print(f"\n{C_DIM}Note: Booking #{winning_booking} retained in database. Use --cleanup flag to auto-remove.{C_RESET}")

def main():
    parser = argparse.ArgumentParser(description="PostgreSQL 16 Concurrency & Race Condition Test")
    parser.add_argument("--category", type=int, default=1, help="Seat Category ID to test (default: 1)")
    parser.add_argument("--seat", type=str, default="RACE-SEAT-01", help="Contested seat number (default: RACE-SEAT-01)")
    parser.add_argument("--threads", type=int, default=10, help="Number of concurrent threads (default: 10)")
    parser.add_argument("--cleanup", action="store_true", help="Auto-delete the test booking afterwards")
    args = parser.parse_args()

    run_concurrency_test(
        category_id=args.category,
        seat_number=args.seat,
        num_threads=args.threads,
        auto_cleanup=args.cleanup
    )

if __name__ == "__main__":
    main()
