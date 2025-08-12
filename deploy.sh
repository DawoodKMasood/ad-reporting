#!/bin/bash

# Exit on any error
set -e

echo "Deploying ad-reporting application..."

# Install dependencies
echo "Installing dependencies..."
npm ci

# Build the application
echo "Building application..."
npm run build

# Set executable permissions on start script
chmod +x start.sh

echo "Deployment complete!"
echo ""
echo "To start the server:"
echo "  npm run start:prod"
echo "  OR"
echo "  ./start.sh"
echo "  OR"
echo "  pm2 start ecosystem.config.js"
echo ""
echo "The server will run on http://0.0.0.0:3333"
