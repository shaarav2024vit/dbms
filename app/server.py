"""
Event and Ticket Booking System - Web Server & REST API
BCSE302L - Database Systems
Authors: Kevin T John (24BYB0163), Govind B Nair (24BYB0101), Shaarav S (24BYB0118)
"""

import os
import json
from flask import Flask, render_template, request, jsonify
from db import (
    test_connection, get_overview_stats, get_users_list, get_public_catalog,
    get_event_categories, get_category_seat_map, get_event_details, get_user_wallet, get_user_bookings,
    get_booking_details, book_tickets, make_payment, get_refund_quote,
    cancel_booking, get_organizer_events, add_seat_category,
    run_settle_cancellations, run_expire_stale_bookings,
    get_customer_spend_report, run_query, get_event_atlas_data
)

app = Flask(__name__, static_folder="static", template_folder="templates")

# Helper for JSON serialization of dates & decimals
def format_row(row):
    if not row:
        return row
    formatted = {}
    for k, v in row.items():
        if isinstance(v, bool):
            formatted[k] = v
        elif isinstance(v, int):
            formatted[k] = v
        elif hasattr(v, "isoformat"):
            formatted[k] = v.isoformat()
        elif hasattr(v, "__float__"):
            formatted[k] = float(v)
        else:
            formatted[k] = v
    return formatted

def format_rows(rows):
    return [format_row(r) for r in rows]

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/health")
def health():
    ok, info = test_connection()
    stats = {}
    if ok:
        try:
            stats = get_overview_stats()
        except Exception as e:
            stats = {"error": str(e)}
    return jsonify({
        "connected": ok,
        "database": "PostgreSQL 16",
        "info": info if ok else None,
        "error": None if ok else info,
        "stats": stats
    })

@app.route("/api/users")
def list_users():
    try:
        users = get_users_list()
        return jsonify({"success": True, "users": format_rows(users)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/catalog")
def catalog():
    try:
        events = get_public_catalog()
        return jsonify({"success": True, "events": format_rows(events)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/events/<int:event_id>")
def event_detail(event_id):
    try:
        event = get_event_details(event_id)
        if not event:
            return jsonify({"success": False, "error": "Event not found"}), 404
        categories = get_event_categories(event_id)
        return jsonify({
            "success": True,
            "event": format_row(event),
            "categories": format_rows(categories)
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/atlas/events/<int:event_id>")
def atlas_event(event_id):
    try:
        data = get_event_atlas_data(event_id)
        if not data:
            return jsonify({"success": False, "error": "Event not found"}), 404
        
        formatted_data = {
            "event": format_row(data["event"]),
            "venue": format_row(data["venue"]),
            "organizer": format_row(data["organizer"]),
            "categories": format_rows(data["categories"]),
            "bookings": []
        }
        for b in data["bookings"]:
            b_copy = format_row(b)
            b_copy["tickets"] = format_rows(b.get("tickets", []))
            b_copy["payments"] = format_rows(b.get("payments", []))
            b_copy["cancellation"] = format_row(b["cancellation"]) if b.get("cancellation") else None
            formatted_data["bookings"].append(b_copy)

        return jsonify({"success": True, "data": formatted_data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/categories/<int:category_id>/seats")
def category_seats(category_id):
    try:
        data = get_category_seat_map(category_id)
        if not data:
            return jsonify({"success": False, "error": "Category not found"}), 404
        return jsonify({
            "success": True,
            "data": format_row(data)
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/users/<int:user_id>/tickets")
def user_tickets(user_id):
    try:
        tickets = get_user_wallet(user_id)
        return jsonify({"success": True, "tickets": format_rows(tickets)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/users/<int:user_id>/bookings")
def user_bookings(user_id):
    try:
        bookings = get_user_bookings(user_id)
        return jsonify({"success": True, "bookings": format_rows(bookings)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/bookings/<int:booking_id>")
def booking_detail(booking_id):
    try:
        b = get_booking_details(booking_id)
        if not b:
            return jsonify({"success": False, "error": "Booking not found"}), 404
        
        b_formatted = format_row(b)
        b_formatted["tickets"] = format_rows(b["tickets"])
        b_formatted["payments"] = format_rows(b["payments"])
        b_formatted["cancellation"] = format_row(b["cancellation"]) if b.get("cancellation") else None
        return jsonify({"success": True, "booking": b_formatted})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# =============================================================================
# TRANSACTION ENDPOINTS
# =============================================================================

@app.route("/api/bookings", methods=["POST"])
def create_booking():
    """
    Executes Procedure: sp_book_tickets
    Triggers fired: trg_ticket_validate, trg_ticket_inventory
    """
    data = request.json or {}
    user_id = data.get("user_id")
    category_id = data.get("category_id")
    seats = data.get("seats", [])
    
    if not user_id or not category_id or not seats:
        return jsonify({"success": False, "error": "user_id, category_id, and seats are required"}), 400
    
    try:
        booking_id, notices = book_tickets(int(user_id), int(category_id), seats)
        return jsonify({
            "success": True,
            "booking_id": booking_id,
            "operation": "Atomic Multi-Ticket Reservation",
            "procedure": "CALL sp_book_tickets(%s, %s, %s, NULL)",
            "triggers_fired": ["trg_ticket_validate", "trg_ticket_inventory"],
            "notices": notices
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

@app.route("/api/payments", methods=["POST"])
def process_payment():
    """
    Executes Procedure: sp_make_payment
    Triggers fired: trg_payment_confirm_booking (on success)
    """
    data = request.json or {}
    booking_id = data.get("booking_id")
    method = data.get("payment_method", "UPI")
    simulate_success = bool(data.get("simulate_success", True))
    
    if not booking_id:
        return jsonify({"success": False, "error": "booking_id is required"}), 400
        
    try:
        ok, notices = make_payment(int(booking_id), method, simulate_success)
        return jsonify({
            "success": True,
            "payment_status": "SUCCESS" if simulate_success else "FAILED",
            "operation": "Booking Payment Execution",
            "procedure": "CALL sp_make_payment(%s, %s, %s)",
            "triggers_fired": ["trg_payment_confirm_booking"] if simulate_success else [],
            "notices": notices
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

@app.route("/api/cancellations/quote/<int:booking_id>")
def refund_quote(booking_id):
    """
    Executes Function: fn_calculate_refund
    """
    try:
        amount = get_refund_quote(booking_id)
        return jsonify({
            "success": True,
            "booking_id": booking_id,
            "refund_amount": amount,
            "function": "SELECT fn_calculate_refund(%s)"
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

@app.route("/api/cancellations", methods=["POST"])
def request_cancellation():
    """
    Executes Procedure: sp_cancel_booking
    Invokes fn_calculate_refund, fires trg_ticket_inventory (restores seats)
    """
    data = request.json or {}
    booking_id = data.get("booking_id")
    reason = data.get("reason", "Customer requested cancellation")
    
    if not booking_id:
        return jsonify({"success": False, "error": "booking_id is required"}), 400
        
    try:
        ok, notices = cancel_booking(int(booking_id), reason)
        return jsonify({
            "success": True,
            "operation": "Immediate Booking Cancellation",
            "procedure": "CALL sp_cancel_booking(%s, %s)",
            "function_called": "fn_calculate_refund(booking_id)",
            "triggers_fired": ["trg_ticket_inventory (restores seats)"],
            "notices": notices
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

@app.route("/api/organizers/<int:organizer_id>/events")
def organizer_events(organizer_id):
    try:
        events = get_organizer_events(organizer_id)
        return jsonify({"success": True, "events": format_rows(events)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/organizers/categories", methods=["POST"])
def create_category():
    """
    Fires trigger: trg_category_capacity
    """
    data = request.json or {}
    event_id = data.get("event_id")
    cat_name = data.get("category_name")
    price = data.get("price")
    seats = data.get("total_seats")
    
    if not event_id or not cat_name or price is None or not seats:
        return jsonify({"success": False, "error": "Missing required fields"}), 400
        
    try:
        created = add_seat_category(int(event_id), cat_name, float(price), int(seats))
        return jsonify({
            "success": True,
            "category": format_row(created),
            "operation": "Add Event Seating Tier",
            "trigger_verified": "trg_category_capacity passed capacity check"
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

@app.route("/api/admin/settle-cancellations", methods=["POST"])
def admin_settle():
    """
    Executes Cursor: sp_settle_approved_cancellations
    """
    try:
        notices = run_settle_cancellations()
        return jsonify({
            "success": True,
            "operation": "Batch Settlement of Approved Cancellations",
            "cursor_procedure": "CALL sp_settle_approved_cancellations()",
            "cursor_type": "Explicit CURSOR with FOR UPDATE OF c and WHERE CURRENT OF",
            "notices": notices
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/admin/expire-stale", methods=["POST"])
def admin_expire():
    """
    Executes Cursor: sp_expire_stale_bookings
    """
    data = request.json or {}
    hours = data.get("hours", 24)
    try:
        notices = run_expire_stale_bookings(hours)
        return jsonify({
            "success": True,
            "operation": "Batch Expiration of Unpaid Checkouts",
            "cursor_procedure": f"CALL sp_expire_stale_bookings(INTERVAL '{hours} hours')",
            "cursor_type": "Parameterized CURSOR cur_stale(cutoff)",
            "notices": notices
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/admin/customer-spend")
def customer_spend():
    try:
        report = get_customer_spend_report()
        return jsonify({"success": True, "report": format_rows(report)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/queries/<query_id>")
def execute_query(query_id):
    try:
        title, sql, results = run_query(query_id)
        if not title:
            return jsonify({"success": False, "error": "Query not found"}), 404
        return jsonify({
            "success": True,
            "query_id": query_id,
            "title": title,
            "sql": sql,
            "row_count": len(results),
            "rows": format_rows(results)
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5050))
    print(f"Starting Ticket Booking System Application on http://localhost:{port}...")
    app.run(host="0.0.0.0", port=port, debug=True)
