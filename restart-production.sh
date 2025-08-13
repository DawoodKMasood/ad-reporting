#!/bin/bash

echo "=== Restarting Ad Reporting Server ==="

# Stop the server first
echo "Stopping server..."
./stop-production.sh

# Wait a moment
sleep 2

# Start the server
echo "Starting server..."
./start-production.sh

echo "Restart complete!"
