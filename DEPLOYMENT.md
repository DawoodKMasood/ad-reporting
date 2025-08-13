# Production Deployment Instructions

## Quick Setup (Ubuntu/Debian)

1. **Make scripts executable:**
```bash
chmod +x *.sh
```

2. **Deploy with systemd (Recommended):**
```bash
sudo ./deploy.sh
```

3. **Or deploy with PM2:**
```bash
./start-production-pm2.sh
```

## Troubleshooting

### NPM Permission Issues
If you see permission errors like "Your cache folder contains root-owned files":
```bash
sudo ./fix-permissions.sh
```

### Missing .env File
The deployment will automatically create a .env from .env.example if it doesn't exist.

### Service Not Starting
1. Check logs: `sudo journalctl -u ad-reporting -f`
2. Check app logs: `tail -f /var/www/ad-reporting/logs/production.log`
3. Fix permissions: `sudo ./fix-permissions.sh`
4. Restart service: `sudo systemctl restart ad-reporting`

### SSL Certificate Issues
If SSL fails, the server will run on HTTP. To retry SSL:
```bash
sudo certbot certonly --webroot -w /var/www/html -d aiden.webredirect.org
sudo systemctl reload nginx
```

## Manual Steps

### 1. Upload to server:
```bash
rsync -avz --exclude node_modules ./ user@server:/var/www/ad-reporting/
```

### 2. Install systemd service:
```bash
sudo cp ad-reporting.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ad-reporting
sudo systemctl start ad-reporting
```

### 3. Setup nginx:
```bash
sudo cp nginx.conf /etc/nginx/sites-available/aiden.webredirect.org
sudo ln -s /etc/nginx/sites-available/aiden.webredirect.org /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 4. Get SSL certificate:
```bash
sudo certbot --nginx -d aiden.webredirect.org
```

### 5. Setup SSL renewal:
```bash
sudo cp ssl-renew.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/ssl-renew.sh
echo "0 2 1 * * /usr/local/bin/ssl-renew.sh" | sudo crontab -
```

## Script Management

### Start/Stop Scripts
- **Start:** `./start-production.sh`
- **Stop:** `./stop-production.sh`
- **Health Check:** `./health-check.sh`
- **Fix Permissions:** `sudo ./fix-permissions.sh`

### Service Management

**Systemd:**
- Status: `sudo systemctl status ad-reporting`
- Logs: `sudo journalctl -u ad-reporting -f`
- Restart: `sudo systemctl restart ad-reporting`
- Start: `sudo systemctl start ad-reporting`
- Stop: `sudo systemctl stop ad-reporting`

**PM2:**
- Status: `pm2 status`
- Logs: `pm2 logs ad-reporting`
- Restart: `pm2 restart ad-reporting`
- Start: `pm2 start ad-reporting`
- Stop: `pm2 stop ad-reporting`

## Log Files
- Application: `/var/www/ad-reporting/logs/`
- Systemd: `sudo journalctl -u ad-reporting`
- Nginx: `/var/log/nginx/aiden.webredirect.org.*.log`
- SSL: `/var/log/ssl-renewal.log`

## Configuration Files

### Required Files
- `.env` - Environment configuration (auto-created from .env.example)
- `ad-reporting.service` - Systemd service configuration
- `nginx.conf` - Nginx virtual host configuration
- `ecosystem.config.js` - PM2 configuration

### Environment Variables (.env)
```env
NODE_ENV=production
PORT=3333
APP_KEY=your-32-character-random-string-here
HOST=0.0.0.0
DB_CONNECTION=pg
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your-password
DB_DATABASE=ad_reporting
```

## Common Issues

### 1. "Cannot stat '.env'" Error
- Solution: Run `cp .env.example .env` or the deploy script will create it

### 2. NPM Permission Errors
- Solution: Run `sudo ./fix-permissions.sh`

### 3. Nginx Configuration Error
- Check: `sudo nginx -t`
- Fix config and reload: `sudo systemctl reload nginx`

### 4. Service Won't Start
- Check logs: `sudo journalctl -u ad-reporting -n 50`
- Verify build: Check if `/var/www/ad-reporting/build/` exists
- Fix permissions: `sudo ./fix-permissions.sh`

### 5. SSL Certificate Issues
- Verify domain points to server
- Check firewall allows ports 80/443
- Manual renewal: `sudo certbot renew`

## Security

### Firewall Setup
```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### File Permissions
- App files: `www-data:www-data`
- Service runs as: `www-data`
- Scripts should be executable: `chmod +x *.sh`

## Monitoring

### Health Check
Run the health check script regularly:
```bash
./health-check.sh
```

### Automated Monitoring
Add to crontab for regular health checks:
```bash
# Check every 5 minutes
*/5 * * * * /var/www/ad-reporting/health-check.sh >> /var/log/ad-reporting-health.log 2>&1
```
