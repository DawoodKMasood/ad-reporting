# Production Deployment Instructions

## Quick Setup (Ubuntu/Debian)

1. **Make scripts executable:**
```bash
chmod +x *.sh
```

2. **Deploy with systemd:**
```bash
sudo ./deploy.sh
```

3. **Or deploy with PM2:**
```bash
./start-production-pm2.sh
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

## Service Management

**Systemd:**
- Status: `sudo systemctl status ad-reporting`
- Logs: `sudo journalctl -u ad-reporting -f`
- Restart: `sudo systemctl restart ad-reporting`

**PM2:**
- Status: `pm2 status`
- Logs: `pm2 logs ad-reporting`
- Restart: `pm2 restart ad-reporting`

## Log Files
- Application: `/var/www/ad-reporting/logs/`
- Nginx: `/var/log/nginx/aiden.webredirect.org.*.log`
- SSL: `/var/log/ssl-renewal.log`
