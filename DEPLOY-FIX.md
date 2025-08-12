# Quick AWS Deployment Fix

## Memory Error Solution

1. **Make scripts executable:**
   ```bash
   bash make-executable.sh
   ```

2. **Setup swap for 2GB instances:**
   ```bash
   sudo bash aws/setup-swap.sh
   ```

3. **Clean and optimized build:**
   ```bash
   npm run build:optimized
   ```

4. **Start with PM2:**
   ```bash
   pm2 start ecosystem.config.js
   ```

## Alternative Commands

- **Clean failed build:** `npm run build:clean`
- **Full cleanup:** `bash aws/clean-build.sh`
- **Direct PM2 start:** `npm run pm2:start`

## Check Status
```bash
pm2 status
pm2 logs
free -h  # Check memory
```
