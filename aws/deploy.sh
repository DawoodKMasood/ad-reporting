#!/bin/bash
# AWS Deployment Script

# Exit on any error
set -e

echo "Starting deployment..."

# Install dependencies
npm ci --only=production

# Build the application
npm run build

# Create logs directory if it doesn't exist
mkdir -p logs

# Stop PM2 if running
pm2 stop ecosystem.config.js || true

# Start the application with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

echo "Deployment completed successfully!"
