#!/usr/bin/env python3
"""
Universal Database Initializer (Cross-Platform)
Works on Linux (Arch, CachyOS, EndeavourOS, Ubuntu), macOS (Apple Silicon / Intel), Windows.
Does not require psql CLI or docker exec on host; connects directly via psycopg2.
"""

import sys
import os
import time

try:
    import psycopg2
except ImportError:
    print("Error: psycopg2 is not installed. Run 'pip install -r requirements.txt'")
    sys.exit(1)

DB_NAME = os.environ.get("DB_NAME", "ticket_booking_system")
DB_USER = os.environ.get("DB_USER", "postgres")
DB_PASS = os.environ.get("DB_PASSWORD", "postgrespassword")
DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = int(os.environ.get("DB_PORT", 5432))

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

SQL_FILES = [
    os.path.join(ROOT_DIR, "database", "01_schema.sql"),
    os.path.join(ROOT_DIR, "database", "02_seed_data.sql"),
    os.path.join(ROOT_DIR, "database", "04_plsql.sql"),
]

def wait_for_postgres(timeout=30):
    print(f"Connecting to PostgreSQL at {DB_HOST}:{DB_PORT} (timeout: {timeout}s)...")
    start = time.time()
    last_err = None
    while time.time() - start < timeout:
        try:
            # First try connecting to default postgres db if target doesn't exist
            conn = psycopg2.connect(
                dbname="postgres",
                user=DB_USER,
                password=DB_PASS,
                host=DB_HOST,
                port=DB_PORT,
                connect_timeout=2
            )
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute(f"SELECT 1 FROM pg_database WHERE datname = '{DB_NAME}';")
                if not cur.fetchone():
                    print(f"Database '{DB_NAME}' does not exist. Creating it now...")
                    cur.execute(f"CREATE DATABASE {DB_NAME};")
            conn.close()
            return True
        except Exception as e:
            last_err = e
            time.sleep(1)
    print(f"Failed to connect to PostgreSQL: {last_err}")
    return False

def check_tables_exist():
    try:
        conn = psycopg2.connect(
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASS,
            host=DB_HOST,
            port=DB_PORT
        )
        with conn.cursor() as cur:
            cur.execute("SELECT to_regclass('public.event');")
            exists = cur.fetchone()[0] is not None
        conn.close()
        return exists
    except Exception:
        return False

def apply_sql_files(force=False):
    if not force and check_tables_exist():
        print(f"✔ Database '{DB_NAME}' is already initialized with existing tables and records.")
        return True

    print(f"Initializing database '{DB_NAME}' from SQL scripts...")
    conn = psycopg2.connect(
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASS,
        host=DB_HOST,
        port=DB_PORT
    )
    conn.autocommit = True

    try:
        with conn.cursor() as cur:
            for sql_path in SQL_FILES:
                filename = os.path.basename(sql_path)
                print(f"  → Applying {filename}...")
                with open(sql_path, "r", encoding="utf-8") as f:
                    sql_content = f.read()
                    cur.execute(sql_content)
        print("✔ Database schema, seed data, and PL/pgSQL routines applied successfully!")
        return True
    except Exception as e:
        print(f"❌ Error applying SQL files: {e}")
        return False
    finally:
        conn.close()

if __name__ == "__main__":
    force_reset = "--force" in sys.argv or "--reset" in sys.argv
    if not wait_for_postgres():
        sys.exit(1)
    if not apply_sql_files(force=force_reset):
        sys.exit(1)
