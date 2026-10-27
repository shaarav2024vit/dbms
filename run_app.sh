#!/usr/bin/env bash
# ==============================================================================
# Helper to run the Web App or CLI without worrying about shell / virtualenv activation
# Works in fish, bash, zsh, etc.
# ==============================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="$DIR/venv/bin/python3"

if [ ! -f "$PYTHON" ]; then
    echo "Python virtual environment not found in $DIR/venv."
    exit 1
fi

case "$1" in
    cli)
        "$PYTHON" "$DIR/cli_app.py"
        ;;
    race)
        "$PYTHON" "$DIR/test_race_condition.py" "${@:2}"
        ;;
    benchmark)
        "$PYTHON" "$DIR/benchmark_indexes.py"
        ;;
    web|"")
        echo "Starting Web Application on http://localhost:5050 ..."
        "$PYTHON" "$DIR/app/server.py"
        ;;
    *)
        echo "Usage: ./run_app.sh [web|cli|race|benchmark]"
        ;;
esac
