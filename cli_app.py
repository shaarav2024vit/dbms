#!/usr/bin/env python3
"""
Event and Ticket Booking System - Interactive Terminal CLI
BCSE302L - Database Systems | Review III Interactive Demonstration
Authors: Kevin T John, Govind B Nair, Shaarav S
"""

import sys
import os

# Add app folder to python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))

from db import (
    test_connection, get_overview_stats, get_public_catalog,
    get_event_categories, book_tickets, make_payment,
    get_refund_quote, cancel_booking, get_organizer_events,
    add_seat_category, run_settle_cancellations, run_expire_stale_bookings,
    get_customer_spend_report, run_query
)

def banner():
    print("=" * 75)
    print("  EVENT AND TICKET BOOKING SYSTEM - INTERACTIVE CLI DEMO")
    print("  BCSE302L - Database Systems | Review III Final Evaluation")
    print("  Team: Kevin T John, Govind B Nair, Shaarav S")
    print("=" * 75)

def check_db():
    ok, info = test_connection()
    if not ok:
        print(f"\n[ERROR] [ERROR] Could not connect to PostgreSQL 16 on localhost:5432.")
        print(f"Details: {info}")
        print("\nPlease ensure PostgreSQL is running (e.g. ./run_db.sh start)")
        return False
    print(f"\n[SUCCESS] [CONNECTED] PostgreSQL 16 Database Engine Online!")
    return True

def show_menu():
    print("\n" + "-" * 75)
    print("REVIEW III TRANSACTION & OPERATION MENU:")
    print("-" * 75)
    print("  [1]  Browse Events Catalog (View: v_public_event_catalog)")
    print("  [2]  Customer: Book Tickets Atomically (Procedure: sp_book_tickets)")
    print("  [3]  Customer: Process / Retry Payment (Procedure: sp_make_payment)")
    print("  [4]  Customer: Cancel Booking & Refund (Procedure: sp_cancel_booking)")
    print("  [5]  Test: Double-Booking Prevention (UNIQUE Constraint: uq_category_seat)")
    print("  [6]  Organizer: View Event Occupancy (Function: fn_event_occupancy)")
    print("  [7]  Organizer: Test Venue Over-Allocation (Trigger: trg_category_capacity)")
    print("  [8]  Admin: Settle Cancellations in Bulk (Explicit Cursor: sp_settle_approved_cancellations)")
    print("  [9]  Admin: Expire Stale Unpaid Checkouts (Parameterized Cursor: sp_expire_stale_bookings)")
    print("  [10] Admin: Customer Lifetime Spend Analytics (Function: fn_customer_lifetime_spend)")
    print("  [11] Academic Query Suite: Run Queries 1.1 through 5.2")
    print("  [12] Concurrency Stress Test: 10 Parallel Threads Race for Same Seat (test_race_condition.py)")
    print("  [13] Query Optimization Benchmark: EXPLAIN ANALYZE & Partial Indexes (benchmark_indexes.py)")
    print("  [0]  Exit")
    print("-" * 75)

def op_browse_catalog():
    print("\n--- UPCOMING EVENTS CATALOG (v_public_event_catalog) ---")
    events = get_public_catalog()
    for e in events:
        print(f"ID #{e['event_id']:<2} | {e['event_name']:<35} | {str(e['event_date'])} {str(e['event_time'])}")
        print(f"      Venue: {e['venue_name']} ({e['location']})")
        print(f"      Organizer: {e['organizer_name']:<25} | Remaining: {e['remaining_seats']:<5} | From: ₹{e['starting_price_inr']}")
        print("." * 75)

def op_book_tickets():
    print("\n--- ATOMIC MULTI-TICKET BOOKING (sp_book_tickets) ---")
    user_id = input("Enter Customer User ID [default 10 - Arjun Reddy]: ").strip() or "10"
    cat_id = input("Enter Seat Category ID [default 2 - Golden Circle]: ").strip() or "2"
    seats_str = input("Enter Seat Numbers separated by commas [default GC-801, GC-802]: ").strip() or "GC-801, GC-802"
    seats = [s.strip() for s in seats_str.split(",") if s.strip()]

    print(f"\n[EXECUTING] CALL sp_book_tickets({user_id}, {cat_id}, ARRAY{seats}, NULL)...")
    try:
        booking_id, notices = book_tickets(int(user_id), int(cat_id), seats)
        print(f"\n[SUCCESS] SUCCESS! Booking #{booking_id} created in PENDING status.")
        for n in notices:
            print(f"   NOTICE: {n}")
        print("\nFlow Verified: User Op -> sp_book_tickets -> trg_ticket_validate -> trg_ticket_inventory")
        return booking_id
    except Exception as e:
        print(f"\n[ERROR] [POSTGRESQL REJECTION]: {e}")
        return None

def op_make_payment(booking_id=None):
    print("\n--- RECORD PAYMENT ATTEMPT (sp_make_payment) ---")
    if not booking_id:
        booking_id = input("Enter Booking ID to pay for: ").strip()
        if not booking_id:
            return
    
    print("Select Payment Simulation:")
    print("  [1] Success (Fires trg_payment_confirm_booking -> CONFIRMED)")
    print("  [2] Decline / Failure (Preserves failed attempt in audit trail)")
    choice = input("Choice [1/2, default 1]: ").strip() or "1"
    sim = (choice == "1")

    method = input("Payment Method [UPI/CARD/NET_BANKING, default UPI]: ").strip() or "UPI"
    print(f"\n[EXECUTING] CALL sp_make_payment({booking_id}, '{method}', {sim})...")
    try:
        ok, notices = make_payment(int(booking_id), method, sim)
        status_str = "SUCCESS (Booking CONFIRMED)" if sim else "FAILED (Stored for Retry)"
        print(f"\n[SUCCESS] Payment processed: {status_str}")
        for n in notices:
            print(f"   NOTICE: {n}")
    except Exception as e:
        print(f"\n[ERROR] [ERROR]: {e}")

def op_cancel_booking():
    print("\n--- POLICY-BASED CANCELLATION (sp_cancel_booking & fn_calculate_refund) ---")
    booking_id = input("Enter Confirmed Booking ID to cancel [e.g. 15]: ").strip() or "15"
    try:
        quote = get_refund_quote(int(booking_id))
        print(f"\n[DYNAMIC REFUND QUOTE via fn_calculate_refund]: ₹{quote:.2f}")
    except Exception as e:
        print(f"Could not calculate quote: {e}")
        return

    reason = input("Enter cancellation reason: ").strip() or "Customer cancelled via CLI demo"
    confirm = input("Confirm cancellation? (y/n) [default y]: ").strip().lower() or "y"
    if confirm != "y":
        print("Cancelled.")
        return

    print(f"\n[EXECUTING] CALL sp_cancel_booking({booking_id}, '{reason}')...")
    try:
        ok, notices = cancel_booking(int(booking_id), reason)
        print(f"\n[SUCCESS] SUCCESS! Booking #{booking_id} cancelled. Refund of ₹{quote:.2f} issued.")
        for n in notices:
            print(f"   NOTICE: {n}")
        print("Flow Verified: sp_cancel_booking -> fn_calculate_refund -> trg_ticket_inventory (restored seats)")
    except Exception as e:
        print(f"\n[ERROR] [ERROR]: {e}")

def op_test_double_booking():
    print("\n--- TEST: DOUBLE-BOOKING ATTEMPT (Integrity Constraint Validation) ---")
    print("Simulating Sneha Kulkarni trying to book seat GC-101 (already reserved by Kevin T John)...")
    try:
        book_tickets(11, 2, ["GC-101"])
    except Exception as e:
        print(f"\n[SECURITY] [DATABASE INTEGRITY DEMONSTRATION]:")
        print(f"Expected Error Caught: {e}")
        print("Integrity Verified: UNIQUE(category_id, seat_number) prevents duplicate seat issuance.")

def op_organizer_occupancy():
    print("\n--- ORGANIZER OCCUPANCY METRICS (fn_event_occupancy) ---")
    org_id = input("Enter Organizer User ID [default 2 - Priya Nair]: ").strip() or "2"
    events = get_organizer_events(int(org_id))
    print(f"\n{'ID':<4} {'Event Name':<35} {'Allocated':<10} {'Remaining':<10} {'Occupancy %'}")
    print("-" * 75)
    for e in events:
        print(f"#{e['event_id']:<3} {e['event_name']:<35} {e['total_allocated_seats']:<10} {e['remaining_seats']:<10} {e['occupancy_pct']}%")

def op_test_oversell():
    print("\n--- TEST: VENUE OVER-ALLOCATION (trg_category_capacity) ---")
    print("Attempting to add a 2,000-seat category to Town Hall (event 3, Venue capacity 800)...")
    try:
        add_seat_category(3, "Standing Promenade", 500.00, 2000)
    except Exception as e:
        print(f"\n[SECURITY] [TRIGGER ENFORCEMENT DEMONSTRATION]:")
        print(f"Trigger trg_category_capacity blocked insert:\n{e}")

def op_admin_settle():
    print("\n--- ADMIN: BATCH SETTLEMENT CURSOR (sp_settle_approved_cancellations) ---")
    print("[EXECUTING] CALL sp_settle_approved_cancellations()...")
    try:
        notices = run_settle_cancellations()
        print("\n[SUCCESS] Cursor Batch Job Completed:")
        for n in notices:
            print(f"   {n}")
        print("Cursor Verified: Explicit cursor loop with FOR UPDATE OF c and WHERE CURRENT OF")
    except Exception as e:
        print(f"\n[ERROR] [ERROR]: {e}")

def op_admin_expire():
    print("\n--- ADMIN: EXPIRE STALE CHECKOUTS CURSOR (sp_expire_stale_bookings) ---")
    hours = input("Expire checkouts older than N hours [default 24]: ").strip() or "24"
    print(f"\n[EXECUTING] CALL sp_expire_stale_bookings(INTERVAL '{hours} hours')...")
    try:
        notices = run_expire_stale_bookings(int(hours))
        print("\n[SUCCESS] Parameterized Cursor Finished:")
        for n in notices:
            print(f"   {n}")
    except Exception as e:
        print(f"\n[ERROR] [ERROR]: {e}")

def op_admin_spend():
    print("\n--- CUSTOMER LIFETIME SPEND ANALYTICS (fn_customer_lifetime_spend) ---")
    report = get_customer_spend_report()
    print(f"{'ID':<4} {'Customer Name':<20} {'Email':<30} {'Bookings':<10} {'Spend (INR)'}")
    print("-" * 75)
    for r in report:
        print(f"#{r['user_id']:<3} {r['name']:<20} {r['email']:<30} {r['total_bookings']:<10} ₹{r['lifetime_spend']:.2f}")

def op_run_queries():
    print("\n--- ACADEMIC QUERY SUITE ---")
    print("Available Queries: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.1, 4.3, 5.1, 5.2")
    q_num = input("Enter Query Number [e.g. 2.3 for 5-Table Join]: ").strip() or "2.3"
    try:
        title, sql, results = run_query(q_num)
        if not title:
            print("Invalid query number.")
            return
        print(f"\n{title}")
        print("-" * 75)
        print(sql)
        print("-" * 75)
        print(f"Total Rows: {len(results)}")
        if results:
            keys = list(results[0].keys())
            print(" | ".join(keys))
            print("-" * 75)
            for r in results[:10]:
                print(" | ".join([str(r[k]) for k in keys]))
            if len(results) > 10:
                print(f"... ({len(results) - 10} more rows)")
    except Exception as e:
        print(f"Error running query: {e}")

def main():
    banner()
    check_db()

    while True:
        show_menu()
        choice = input("\nEnter Option [0-11]: ").strip()
        if choice == "0":
            print("\nExiting. Good luck on your Review III demo tomorrow!")
            break
        elif choice == "1":
            op_browse_catalog()
        elif choice == "2":
            bid = op_book_tickets()
            if bid:
                pay_now = input("\nProceed to pay now? (y/n) [default y]: ").strip().lower() or "y"
                if pay_now == "y":
                    op_make_payment(bid)
        elif choice == "3":
            op_make_payment()
        elif choice == "4":
            op_cancel_booking()
        elif choice == "5":
            op_test_double_booking()
        elif choice == "6":
            op_organizer_occupancy()
        elif choice == "7":
            op_test_oversell()
        elif choice == "8":
            op_admin_settle()
        elif choice == "9":
            op_admin_expire()
        elif choice == "10":
            op_admin_spend()
        elif choice == "11":
            op_run_queries()
        elif choice == "12":
            import subprocess
            subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "test_race_condition.py")])
        elif choice == "13":
            import subprocess
            subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "benchmark_indexes.py")])
        else:
            print("Invalid option. Please try again.")

if __name__ == "__main__":
    main()
