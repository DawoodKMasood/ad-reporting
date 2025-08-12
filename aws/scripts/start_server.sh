#!/bin/bash
# Start Server Script

cd /var/www/ad-reporting

# Install dependencies
npm ci --only=production

# Build the application
npm run build

# Create logs directory
mkdir -p logs

# Start the application with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup systemd -u ec2-user --hp /home/ec2-user
