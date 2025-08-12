#!/bin/bash
# Memory optimized build script

echo "Checking memory..."
free -h

echo "Cleaning up..."
rm -rf build
npm cache clean --force

echo "Building with memory optimization..."
NODE_OPTIONS="--max-old-space-size=1536" node ace build

if [ $? -eq 0 ]; then
    echo "Build successful!"
    cd build
    npm ci --omit=dev
    cd ..
    echo "Ready to start with PM2"
else
    echo "Build failed - try creating swap file first: sudo bash aws/setup-swap.sh"
    exit 1
fi
