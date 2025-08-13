#!/bin/bash

echo "=== Ad Reporting Production Deployment ==="

# Variables
DOMAIN="aiden.webredirect.org"
APP_DIR="/var/www/ad-reporting"
SERVICE_NAME="ad-reporting"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (use sudo)"
    exit 1
fi

# Update system
echo "Updating system packages..."
apt update && apt upgrade -y

# Install required packages
echo "Installing required packages..."
apt install -y nginx certbot python3-certbot-nginx nodejs npm git

# Create application directory
echo "Creating application directory..."
mkdir -p $APP_DIR
mkdir -p $APP_DIR/logs

# Copy application files
echo "Copying application files..."
cp -r ./* $APP_DIR/
cd $APP_DIR

# Set ownership
echo "Setting ownership..."
chown -R www-data:www-data $APP_DIR

# Install dependencies and build
echo "Installing dependencies..."
sudo -u www-data npm install
sudo -u www-data npm run build
sudo -u www-data cp .env build/.env
cd build
sudo -u www-data npm ci --omit="dev"
cd ..

# Copy nginx configuration
echo "Setting up nginx..."
cp nginx.conf /etc/nginx/sites-available/$DOMAIN
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test nginx configuration
nginx -t
if [ $? -ne 0 ]; then
    echo "Nginx configuration error!"
    exit 1
fi

# Create temporary nginx config for certbot
echo "Creating temporary nginx config for SSL setup..."
cat > /etc/nginx/sites-available/$DOMAIN.temp << EOF
server {
    listen 80;
    server_name $DOMAIN;
    
    location / {
        proxy_pass http://127.0.0.1:3333;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Use temporary config
cp /etc/nginx/sites-available/$DOMAIN.temp /etc/nginx/sites-enabled/$DOMAIN
systemctl reload nginx

# Install systemd service
echo "Installing systemd service..."
cp $SERVICE_NAME.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable $SERVICE_NAME
systemctl start $SERVICE_NAME

# Wait for service to start
sleep 5

# Check if service is running
if ! systemctl is-active --quiet $SERVICE_NAME; then
    echo "Service failed to start! Check logs:"
    journalctl -u $SERVICE_NAME --no-pager -n 20
    exit 1
fi

# Get SSL certificate
echo "Getting SSL certificate..."
certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN --redirect

# Replace with full nginx config
echo "Installing full nginx configuration..."
cp nginx.conf /etc/nginx/sites-enabled/$DOMAIN
nginx -t && systemctl reload nginx

# Setup automatic certificate renewal
echo "Setting up automatic certificate renewal..."
(crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet") | crontab -

# Setup log rotation
echo "Setting up log rotation..."
cat > /etc/logrotate.d/$SERVICE_NAME << EOF
$APP_DIR/logs/*.log {
    daily
    missingok
    rotate 52
    compress
    delaycompress
    notifempty
    create 644 www-data www-data
    postrotate
        systemctl reload $SERVICE_NAME
    endscript
}
EOF

# Configure firewall
echo "Configuring firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "=== Deployment Complete ==="
echo "Domain: https://$DOMAIN"
echo "Service: $SERVICE_NAME"
echo "Logs: journalctl -u $SERVICE_NAME -f"
echo "App logs: tail -f $APP_DIR/logs/production.log"
echo "Nginx logs: tail -f /var/log/nginx/$DOMAIN.error.log"

# Final service status
systemctl status $SERVICE_NAME --no-pager
