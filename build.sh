#!/bin/bash

# Vercel Build Script for AdonisJS
echo "Starting Vercel build process..."

# Install dependencies
echo "Installing dependencies..."
npm ci

# Build frontend assets with Vite
echo "Building frontend assets..."
npm run build:assets

# Build AdonisJS application
echo "Building AdonisJS application..."
npm run build:vercel

# Verify build output
echo "Verifying build output..."
if [ ! -d "build" ]; then
  echo "Error: Build directory not found"
  exit 1
fi

if [ ! -f "build/bin/server.js" ]; then
  echo "Error: Server file not found"
  exit 1
fi

if [ ! -d "public/assets" ]; then
  echo "Error: Assets directory not found"
  exit 1
fi

echo "Build completed successfully!"
echo "Build directory contents:"
ls -la build/

echo "Public assets:"
ls -la public/assets/ || echo "No assets built"

echo "Build process finished."
