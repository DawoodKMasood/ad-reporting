#!/bin/bash

echo "=== Stopping Ad Reporting Server ==="

# Check for PID file
if [ -f "logs/server.pid" ]; then
    PID=$(cat logs/server.pid)
    echo "Found PID: $PID"
    
    # Check if process is running
    if kill -0 $PID 2>/dev/null; then
        echo "Stopping server (PID: $PID)..."
        kill $PID
        
        # Wait for process to stop
        for i in {1..10}; do
            if ! kill -0 $PID 2>/dev/null; then
                echo "Server stopped successfully"
                rm -f logs/server.pid
                exit 0
            fi
            sleep 1
        done
        
        # Force kill if still running
        echo "Force killing server..."
        kill -9 $PID 2>/dev/null
        rm -f logs/server.pid
        echo "Server force stopped"
    else
        echo "Process not running, cleaning up PID file"
        rm -f logs/server.pid
    fi
else
    echo "No PID file found, checking for running processes..."
    
    # Find and kill any node processes running server.js
    PIDS=$(pgrep -f "node.*bin/server.js" || true)
    if [ -n "$PIDS" ]; then
        echo "Found running server processes: $PIDS"
        kill $PIDS
        echo "Stopped running processes"
    else
        echo "No running server processes found"
    fi
fi

# Stop systemd service if it exists
if systemctl is-active --quiet ad-reporting 2>/dev/null; then
    echo "Stopping systemd service..."
    sudo systemctl stop ad-reporting
fi

echo "Server stop complete"
