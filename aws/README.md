# AWS Deployment Guide

## Prerequisites
- Node.js 18+ installed on AWS instance
- PM2 installed globally
- PostgreSQL database configured
- Environment variables configured

## Quick Deployment

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start with PM2 (builds automatically):**
   ```bash
   npm run pm2:start
   ```

## Manual Build Process

1. **Build the application:**
   ```bash
   npm run build
   ```

2. **Install production dependencies in build directory:**
   ```bash
   cd build
   npm ci --omit=dev
   cd ..
   ```

3. **Start with PM2:**
   ```bash
   pm2 start ecosystem.config.js
   ```

## PM2 Commands

- Start: `npm run pm2:start` (builds and starts)
- Stop: `npm run pm2:stop`
- Restart: `npm run pm2:restart`
- Reload: `npm run pm2:reload`
- Delete: `npm run pm2:delete`
- View logs: `npm run pm2:logs`
- Check status: `npm run pm2:status`

## AWS CodeDeploy

Use the provided `appspec.yml` and scripts in the `aws/` directory for automated deployment with AWS CodeDeploy.

## Environment Configuration

Copy `.env.example` to `.env` and configure:
- Database connection
- Google Ads API credentials
- APP_KEY and ENCRYPTION_KEY
- Set NODE_ENV=production
- Set HOST=0.0.0.0 for AWS deployment

## Auto-start on Reboot

PM2 will automatically configure the application to start on system boot.
