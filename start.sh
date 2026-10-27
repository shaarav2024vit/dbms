#!/usr/bin/env bash
# ==============================================================================
# UNIVERSAL ALL-IN-ONE SETUP & RUN LAUNCHER
# Event and Ticket Booking System — Relational Database Engine (PostgreSQL 16)
#
# Supported Systems:
#   - macOS (Apple Silicon M1/M2/M3/M4 & Intel)
#   - Arch Linux / CachyOS / EndeavourOS / Manjaro
#   - Ubuntu / Debian / Pop!_OS / Linux Mint
#   - Fedora / Red Hat / openSUSE
#
# Usage:
#   ./start.sh             Launch database + initialize + start web interface
#   ./start.sh --reset     Reset and re-seed database tables, then start
#   ./start.sh --cli       Launch interactive terminal CLI interface
#   ./start.sh --race      Run 10-thread concurrency & race condition proof
#   ./start.sh --benchmark Run EXPLAIN ANALYZE index optimization benchmark
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Visual Palette for Terminal Output
BOLD='\033[1m'
ACCENT='\033[38;5;173m' # Warm Terracotta
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${ACCENT}${BOLD}"
echo "  ┌───────────────────────────────────────────────────────────┐"
echo "  │        EVENT & TICKET LEDGER — UNIVERSAL LAUNCHER         │"
echo "  │             PostgreSQL 16 Relational Engine               │"
echo "  └───────────────────────────────────────────────────────────┘"
echo -e "${NC}"

# ------------------------------------------------------------------------------
# 1. DETECT OPERATING SYSTEM & ARCHITECTURE
# ------------------------------------------------------------------------------
OS="$(uname -s)"
ARCH="$(uname -m)"
echo -e "${BOLD}[1/5] Detecting Environment:${NC} $OS ($ARCH)"

OPEN_CMD=""
if [ "$OS" = "Darwin" ]; then
    OPEN_CMD="open"
elif command -v xdg-open >/dev/null 2>&1; then
    OPEN_CMD="xdg-open"
fi

# ------------------------------------------------------------------------------
# 2. PYTHON 3 & VIRTUAL ENVIRONMENT SETUP
# ------------------------------------------------------------------------------
echo -e "${BOLD}[2/5] Checking Python Environment...${NC}"

PY_CMD=""
if command -v python3 >/dev/null 2>&1; then
    PY_CMD="python3"
elif command -v python >/dev/null 2>&1; then
    PY_CMD="python"
else
    echo -e "${RED}Error: Python 3 was not found on your system. Please install Python 3.9+.${NC}"
    exit 1
fi

if [ ! -d "venv" ]; then
    echo "  → Creating Python virtual environment in ./venv..."
    "$PY_CMD" -m venv venv
fi

PYTHON="$DIR/venv/bin/python3"
PIP="$DIR/venv/bin/pip"

# Check if essential packages are installed
if ! "$PYTHON" -c "import flask, psycopg2" >/dev/null 2>&1; then
    echo "  → Installing Python dependencies (flask, psycopg2-binary)..."
    "$PIP" install --upgrade pip --quiet
    "$PIP" install -r requirements.txt --quiet
fi
echo -e "  ${GREEN}✔ Python environment ready ($("$PYTHON" --version))${NC}"

# ------------------------------------------------------------------------------
# 3. DATABASE DETECTION & IDEMPOTENT STARTUP
# ------------------------------------------------------------------------------
echo -e "${BOLD}[3/5] Checking PostgreSQL (Port 5432)...${NC}"

PORT_OPEN=false
if "$PYTHON" -c "import socket; s = socket.socket(); s.settimeout(1); exit(0 if s.connect_ex(('127.0.0.1', 5432)) == 0 else 1)" >/dev/null 2>&1; then
    PORT_OPEN=true
fi

if [ "$PORT_OPEN" = true ]; then
    echo -e "  ${GREEN}✔ PostgreSQL is already listening on localhost:5432.${NC}"
else
    echo "  → PostgreSQL not detected on 5432. Checking Docker..."
    if command -v docker >/dev/null 2>&1; then
        # Check if docker daemon is responsive
        if ! docker info >/dev/null 2>&1; then
            echo -e "${YELLOW}  ⚠ Docker daemon is not active.${NC}"
            if [ "$OS" = "Linux" ]; then
                echo "    Attempting to start Docker daemon with systemctl..."
                if sudo systemctl start docker 2>/dev/null; then
                    echo -e "    ${GREEN}✔ Docker service started successfully.${NC}"
                else
                    echo -e "${RED}    Please run: 'sudo systemctl start docker' in another terminal.${NC}"
                fi
            fi
        fi

        CONTAINER_NAME="ticket_booking_db"
        if docker ps --format '{{.Names}}' | grep -Eq "^${CONTAINER_NAME}\$"; then
            echo "  ✔ Docker container '$CONTAINER_NAME' is active."
        elif docker ps -a --format '{{.Names}}' | grep -Eq "^${CONTAINER_NAME}\$"; then
            echo "  → Starting existing Docker container '$CONTAINER_NAME'..."
            docker start "$CONTAINER_NAME" >/dev/null
        else
            echo "  → Creating and running Docker container '$CONTAINER_NAME' (postgres:16-alpine)..."
            docker run --name "$CONTAINER_NAME" \
                -e POSTGRES_USER=postgres \
                -e POSTGRES_PASSWORD=postgrespassword \
                -e POSTGRES_DB=ticket_booking_system \
                -p 5432:5432 \
                -v "$DIR/database":/docker-entrypoint-initdb.d:ro \
                -d postgres:16-alpine >/dev/null
        fi
    else
        echo -e "${RED}Error: Neither local PostgreSQL nor Docker is running on port 5432.${NC}"
        echo "Please install or start Docker, or start native PostgreSQL service."
        exit 1
    fi
fi

# ------------------------------------------------------------------------------
# 4. DATABASE INITIALIZATION & SEEDING (Auto-runs if tables are missing)
# ------------------------------------------------------------------------------
echo -e "${BOLD}[4/5] Verifying Relational Schema & Seed Records...${NC}"

FORCE_FLAG=""
if [ "$1" = "--reset" ] || [ "$1" = "reset" ]; then
    FORCE_FLAG="--force"
fi

"$PYTHON" "$DIR/init_db.py" $FORCE_FLAG

# ------------------------------------------------------------------------------
# 5. EXECUTE TARGET WORKFLOW
# ------------------------------------------------------------------------------
case "$1" in
    --cli|cli)
        echo -e "${BOLD}[5/5] Launching Interactive Terminal CLI...${NC}"
        "$PYTHON" "$DIR/cli_app.py"
        ;;
    --race|race)
        echo -e "${BOLD}[5/5] Executing 10-Thread Concurrency & Race Condition Test...${NC}"
        "$PYTHON" "$DIR/test_race_condition.py" "${@:2}"
        ;;
    --benchmark|benchmark)
        echo -e "${BOLD}[5/5] Executing Query Plan & Index Benchmark...${NC}"
        "$PYTHON" "$DIR/benchmark_indexes.py"
        ;;
    --reset|reset)
        echo -e "${BOLD}[5/5] Database reset completed. Launching Web App...${NC}"
        # Fall through to web
        exec "$0"
        ;;
    *)
        echo -e "${BOLD}[5/5] Starting Web Application Server on http://localhost:5050 ...${NC}"

        # Clean any stray process on port 5050
        if command -v lsof >/dev/null 2>&1; then
            PID_5050=$(lsof -ti :5050 2>/dev/null || true)
            if [ -n "$PID_5050" ]; then
                echo "  → Releasing port 5050 (killing PID $PID_5050)..."
                kill -9 $PID_5050 2>/dev/null || true
            fi
        fi

        # Auto-open browser in background after 1.5 seconds
        if [ -n "$OPEN_CMD" ]; then
            (sleep 1.5 && "$OPEN_CMD" "http://localhost:5050" >/dev/null 2>&1) &
        fi

        echo -e "\n${GREEN}${BOLD}✔ Application is ready at http://localhost:5050${NC}"
        echo -e "${ACCENT}Press Ctrl+C to stop the application.${NC}\n"

        "$PYTHON" "$DIR/app/server.py"
        ;;
esac
