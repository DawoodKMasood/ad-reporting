#!/bin/bash

echo "=== Ad Reporting Production Update ==="

# Check if .env exists before starting
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo "Creating .env from .env.example..."
        cp .env.example .env
    else
        echo "Error: No .env or .env.example file found!"
        exit 1
    fi
fi

# Pull latest code (if using git)
if [ -d ".git" ]; then
    echo "Pulling latest code..."
    git pull
fi

# Stop existing server
echo "Stopping existing server..."
./stop-production.sh

# Install dependencies
echo "Installing dependencies..."
npm install

# Build application
echo "Building application..."
npm run build

# Copy .env to build directory
echo "Copying .env to build directory..."
cp .env build/.env

# Install production dependencies in build directory
echo "Installing production dependencies..."
cd build
npm ci --omit="dev" --ignore-scripts
cd ..

# If using systemd, restart service
if systemctl is-enabled --quiet ad-reporting 2>/dev/null; then
    echo "Restarting systemd service..."
    sudo systemctl restart ad-reporting
    
    # Wait and check status
    sleep 5
    if systemctl is-active --quiet ad-reporting; then
        echo "Service restarted successfully!"
        systemctl status ad-reporting --no-pager
    else
        echo "Service failed to start! Check logs:"
        journalctl -u ad-reporting --no-pager -n 10
        exit 1
    fi
else
    # Start with regular script
    echo "Starting server..."
    ./start-production.sh
fi

echo "Update complete!"
echo "Check logs: tail -f logs/production.log"
echo "Service status: systemctl status ad-reporting"
