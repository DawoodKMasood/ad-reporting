#!/bin/bash
# Clean and rebuild script

echo "Cleaning up previous build..."

# Stop PM2 if running
pm2 stop all || true
pm2 delete all || true

# Clean build directory
rm -rf build

# Clear npm cache
npm cache clean --force

# Free up memory
echo "Freeing memory..."
sync && echo 3 > /proc/sys/vm/drop_caches || true

echo "Starting fresh build..."

# Build with memory limit
node --max-old-space-size=1536 ace build

echo "Installing production dependencies..."
cd build
npm ci --omit=dev
cd ..

echo "Starting with PM2..."
pm2 start ecosystem.config.js
pm2 save

echo "Done!"
