#!/bin/bash

# Build the application first
echo "Building application..."
npm run build

# Start the server
echo "Starting server on port 3333..."
cd build && node bin/server.js
