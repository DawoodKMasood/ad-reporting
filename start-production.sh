#!/bin/bash

echo "=== Ad Reporting Production Server ==="

# Build application if not built
if [ ! -d "build" ]; then
    echo "Building application..."
    npm run build
fi

# Ensure .env file exists in build directory
if [ ! -f "build/.env" ]; then
    echo "Copying .env file to build directory..."
    cp .env build/.env
fi

# Change to build directory and install production dependencies
echo "Installing production dependencies..."
cd build
npm ci --omit="dev"

# Start the server
echo "Starting server..."
node bin/server.js
