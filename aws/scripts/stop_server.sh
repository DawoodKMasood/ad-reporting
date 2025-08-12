#!/bin/bash
# Stop Server Script

cd /var/www/ad-reporting

# Stop PM2 processes
pm2 stop all || true
pm2 delete all || true
