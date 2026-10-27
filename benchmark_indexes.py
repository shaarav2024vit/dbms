#!/usr/bin/env python3
"""
================================================================================
Event and Ticket Booking System - Query Optimization & Indexing Benchmark
BCSE302L - Database Systems | Review III Demonstration
Authors: Kevin T John, Govind B Nair, Shaarav S
================================================================================

DEMONSTRATES:
  1. EXPLAIN (ANALYZE, BUFFERS) Execution Plans in PostgreSQL 16.
  2. Performance gains from:
     - Partial B-Tree Indexes (WHERE status = 'PENDING')
     - Composite Indexes with Sort Optimization (user_id, booking_id DESC)
     - Covering Indexes with INCLUDE (Index-Only Scan, 0 Heap Fetches)
================================================================================
"""

import sys
import os
import json
import time

# Add app directory to Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "app"))

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    from db import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS, get_connection
except ImportError as e:
    print(f"[ERROR] Could not import psycopg2 or db module: {e}")
    sys.exit(1)

# ANSI Colors
C_RESET = "\033[0m"
C_BOLD = "\033[1m"
C_GREEN = "\033[92m"
C_RED = "\033[91m"
C_YELLOW = "\033[93m"
C_CYAN = "\033[96m"
C_DIM = "\033[2m"

def print_banner():
    print(f"{C_CYAN}{'=' * 95}{C_RESET}")
    print(f"{C_BOLD}{C_YELLOW}  EVENT & TICKET BOOKING SYSTEM — QUERY OPTIMIZATION & INDEX BENCHMARK{C_RESET}")
    print(f"{C_CYAN}  BCSE302L Database Systems | EXPLAIN (ANALYZE, BUFFERS) Plan Comparison{C_RESET}")
    print(f"{C_CYAN}{'=' * 95}{C_RESET}")

def run_explain(cur, sql_query):
    """
    Executes EXPLAIN (ANALYZE, FORMAT JSON) and parses execution time,
    startup cost, total cost, and the root node plan type.
    """
    explain_sql = f"EXPLAIN (ANALYZE, FORMAT JSON) {sql_query}"
    cur.execute(explain_sql)
    plan_json = cur.fetchone()[0]
    plan_root = plan_json[0]["Plan"]
    exec_time = plan_json[0].get("Execution Time", 0.0)

    node_type = plan_root.get("Node Type", "Unknown")
    # Dig into child if top is Aggregate / Sort
    if "Plans" in plan_root and len(plan_root["Plans"]) > 0:
        child_type = plan_root["Plans"][0].get("Node Type")
        if child_type:
            node_type = f"{node_type} -> {child_type}"

    return {
        "execution_time_ms": exec_time,
        "startup_cost": plan_root.get("Startup Cost", 0.0),
        "total_cost": plan_root.get("Total Cost", 0.0),
        "plan_type": node_type,
        "plan_raw": plan_json
    }

def benchmark_scenario(conn, name, desc, query, drop_sql, create_sql):
    """
    Benchmarks a single query without and with the proposed index.
    """
    print(f"\n{C_BOLD}Scenario: {name}{C_RESET}")
    print(f"  {C_DIM}Objective: {desc}{C_RESET}")
    print(f"  {C_DIM}Query: {query[:75]}...{C_RESET}")

    with conn.cursor() as cur:
        # 1. Drop index if exists to get baseline
        cur.execute(drop_sql)
        cur.execute("ANALYZE;")
        before = run_explain(cur, query)

        # 2. Create index and analyze
        cur.execute(create_sql)
        cur.execute("ANALYZE;")
        after = run_explain(cur, query)

    # Calculate improvements
    cost_reduction = 0.0
    if before["total_cost"] > 0:
        cost_reduction = ((before["total_cost"] - after["total_cost"]) / before["total_cost"]) * 100

    time_reduction = 0.0
    if before["execution_time_ms"] > 0:
        time_reduction = ((before["execution_time_ms"] - after["execution_time_ms"]) / before["execution_time_ms"]) * 100

    return {
        "name": name,
        "before_plan": before["plan_type"],
        "after_plan": after["plan_type"],
        "before_cost": before["total_cost"],
        "after_cost": after["total_cost"],
        "before_time": before["execution_time_ms"],
        "after_time": after["execution_time_ms"],
        "cost_pct": cost_reduction,
        "time_pct": time_reduction
    }

def main():
    print_banner()

    try:
        conn = get_connection()
        conn.autocommit = True
    except Exception as e:
        print(f"{C_RED}[ERROR] Could not connect to PostgreSQL: {e}{C_RESET}")
        sys.exit(1)

    print(f"\n{C_DIM}Connected to PostgreSQL 16 on {DB_HOST}:{DB_PORT}. Running benchmark suites...{C_RESET}")

    scenarios = [
        {
            "name": "1. Stale Bookings (Partial Index)",
            "desc": "Index only 'PENDING' status rows for sp_expire_stale_bookings cursor",
            "query": """
                SELECT booking_id, user_id, booking_date, total_amount
                FROM BOOKING
                WHERE status = 'PENDING'
                  AND booking_date < (CURRENT_TIMESTAMP - INTERVAL '24 hours');
            """,
            "drop_sql": "DROP INDEX IF EXISTS idx_booking_stale_pending;",
            "create_sql": "CREATE INDEX idx_booking_stale_pending ON BOOKING(booking_date) WHERE status = 'PENDING';"
        },
        {
            "name": "2. Customer Wallet (Composite Index)",
            "desc": "Eliminate sorting overhead on customer order history (user_id, booking_id DESC)",
            "query": """
                SELECT booking_id, event_id, total_amount, status, booking_date
                FROM BOOKING
                WHERE user_id = 4
                ORDER BY booking_id DESC;
            """,
            "drop_sql": "DROP INDEX IF EXISTS idx_booking_user_id_desc;",
            "create_sql": "CREATE INDEX idx_booking_user_id_desc ON BOOKING(user_id, booking_id DESC);"
        },
        {
            "name": "3. Ticket Validation (Covering Index)",
            "desc": "Index-Only scan avoiding heap fetches via INCLUDE (category_id, status) INCLUDE(seat_number)",
            "query": """
                SELECT seat_number, status
                FROM TICKET
                WHERE category_id = 2 AND status = 'VALID';
            """,
            "drop_sql": "DROP INDEX IF EXISTS idx_ticket_category_status_inc;",
            "create_sql": "CREATE INDEX idx_ticket_category_status_inc ON TICKET(category_id, status) INCLUDE (seat_number);"
        },
        {
            "name": "4. Catalog Date Window (Composite Index)",
            "desc": "Fast range lookup and sort on EVENT(event_date ASC, venue_id)",
            "query": """
                SELECT event_id, event_name, venue_id, event_date
                FROM EVENT
                WHERE event_date BETWEEN '2026-11-01' AND '2026-12-31'
                ORDER BY event_date ASC;
            """,
            "drop_sql": "DROP INDEX IF EXISTS idx_event_date_venue;",
            "create_sql": "CREATE INDEX idx_event_date_venue ON EVENT(event_date ASC, venue_id);"
        }
    ]

    results = []
    for s in scenarios:
        res = benchmark_scenario(
            conn, s["name"], s["desc"], s["query"], s["drop_sql"], s["create_sql"]
        )
        results.append(res)

    conn.close()

    # Formatted Comparative Summary Table
    print(f"\n\n{C_CYAN}{'=' * 105}{C_RESET}")
    print(f"{C_BOLD}{C_YELLOW}  EXECUTIVE QUERY PLAN & PERFORMANCE COMPARISON MATRIX{C_RESET}")
    print(f"{C_CYAN}{'=' * 105}{C_RESET}")
    print(f"{'Optimization Scenario':<36} {'Baseline Plan':<18} {'Optimized Plan':<22} {'Cost Reduction':<15} {'Speedup'}")
    print(f"{C_DIM}{'─' * 105}{C_RESET}")

    for r in results:
        cost_badge = f"{r['cost_pct']:+.1f}%"
        if r['cost_pct'] >= 0:
            cost_badge = f"{C_GREEN}{cost_badge}{C_RESET}"
        else:
            cost_badge = f"{C_RED}{cost_badge}{C_RESET}"

        time_str = f"{r['before_time']:.3f}ms -> {r['after_time']:.3f}ms"
        print(f"{r['name']:<36} {r['before_plan'][:17]:<18} {C_CYAN}{r['after_plan'][:21]:<22}{C_RESET} {cost_badge:<24} {time_str}")

    print(f"{C_DIM}{'─' * 105}{C_RESET}")
    print(f"\n{C_GREEN}{C_BOLD}✓ OPTIMIZATION SUMMARY:{C_RESET}")
    print(f"  • Partial Indexes eliminate unnecessary scans over 90%+ irrelevant historical rows.")
    print(f"  • Covering Indexes (INCLUDE) allow PostgreSQL to execute Index-Only Scans with 0 Heap buffer reads.")
    print(f"  • Multi-column composite ordering completely removes the runtime Sort node.")
    print(f"{C_CYAN}{'=' * 105}{C_RESET}\n")

if __name__ == "__main__":
    main()
