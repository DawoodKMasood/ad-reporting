#!/bin/bash
# AWS Deployment Script

# Exit on any error
set -e

echo "Starting deployment..."

# Install dependencies
npm ci

# Build the application
npm run build

# Install production dependencies in build directory
cd build
npm ci --omit=dev
cd ..

# Create logs directory if it doesn't exist
mkdir -p logs

# Stop PM2 if running
pm2 stop ecosystem.config.js || true

# Start the application with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

echo "Deployment completed successfully!"
