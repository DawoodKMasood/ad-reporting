#!/bin/bash

echo "=== Ad Reporting Production Server ==="

# Check if .env exists, if not copy from example
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo "Creating .env from .env.example..."
        cp .env.example .env
    else
        echo "Error: No .env or .env.example file found!"
        echo "Please create a .env file with your configuration."
        exit 1
    fi
fi

# Install dependencies
echo "Installing dependencies..."
npm install

# Copy .env file (ensure it exists)
echo "Ensuring .env file exists..."
if [ ! -f ".env" ]; then
    echo "Error: .env file still missing!"
    exit 1
fi

# Build application
echo "Building application..."
npm run build

# Ensure build directory exists
if [ ! -d "build" ]; then
    echo "Error: Build directory was not created!"
    exit 1
fi

# Ensure .env file exists in build directory
echo "Copying .env file to build directory..."
cp .env build/.env

# Change to build directory and install production dependencies
echo "Installing production dependencies in build directory..."
cd build

# Clean install production dependencies
npm ci --omit="dev" --ignore-scripts

# Create logs directory if it doesn't exist
mkdir -p ../logs

# Check if server file exists
if [ ! -f "bin/server.js" ]; then
    echo "Error: Server file bin/server.js not found in build directory!"
    exit 1
fi

# Start the server in background
echo "Starting server in background..."
nohup node bin/server.js > ../logs/production.log 2>&1 &
SERVER_PID=$!

# Save PID for later management
echo $SERVER_PID > ../logs/server.pid

echo "Server started successfully!"
echo "PID: $SERVER_PID"
echo "Logs: tail -f logs/production.log"
echo "Stop: kill $SERVER_PID"

# Wait a moment and check if process is still running
sleep 2
if kill -0 $SERVER_PID 2>/dev/null; then
    echo "Server is running successfully"
else
    echo "Server failed to start. Check logs/production.log for details"
    cat ../logs/production.log
    exit 1
fi
