#!/bin/bash

echo "=== Fixing NPM Permission Issues ==="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (use sudo)"
    exit 1
fi

APP_DIR="/var/www/ad-reporting"

echo "Fixing NPM cache permissions..."
chown -R www-data:www-data /var/www/.npm 2>/dev/null || true
mkdir -p /var/www/.npm
chown -R www-data:www-data /var/www/.npm

echo "Fixing application directory permissions..."
chown -R www-data:www-data $APP_DIR

echo "Cleaning NPM cache..."
sudo -u www-data npm cache clean --force

echo "Fixing node_modules permissions in build directory..."
if [ -d "$APP_DIR/build/node_modules" ]; then
    chown -R www-data:www-data $APP_DIR/build/node_modules
fi

echo "Permissions fixed successfully!"
