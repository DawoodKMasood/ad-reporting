#!/bin/bash
# AWS Startup Script

# Exit on any error
set -e

echo "Starting application startup..."

# Install PM2 globally if not already installed
npm install -g pm2

# Start PM2 daemon
pm2 startup

# Load PM2 configuration and start the application
pm2 start ecosystem.config.js

# Save PM2 configuration for auto-restart
pm2 save

echo "Application started successfully!"
