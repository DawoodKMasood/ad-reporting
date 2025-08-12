# AWS Deployment Guide

## Prerequisites
- Node.js 18+ installed on AWS instance
- PM2 installed globally
- PostgreSQL database configured
- Environment variables configured
- **Recommended**: 4GB+ RAM or swap file for build process

## Memory Issue on 2GB Instances

If you get memory errors during build:

1. **Setup swap file (recommended):**
   ```bash
   sudo bash aws/setup-swap.sh
   ```

2. **Use optimized build:**
   ```bash
   npm run build:optimized
   pm2 start ecosystem.config.js
   ```

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

1. **Clean build (if previous failed):**
   ```bash
   npm run build:clean
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

## Troubleshooting

**Memory errors during build:**
- Run `sudo bash aws/setup-swap.sh` to add swap space
- Use `npm run build:optimized` instead of regular build
- Clean failed builds: `npm run build:clean`

**Build cleanup:**
```bash
bash aws/clean-build.sh
```

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
