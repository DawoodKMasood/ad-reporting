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

# Function to check command existence
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Update system
echo "Updating system packages..."
apt update && apt upgrade -y

# Install Node.js if not installed
if ! command_exists node; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt install -y nodejs
fi

# Install required packages
echo "Installing required packages..."
apt install -y nginx certbot python3-certbot-nginx git curl

# Fix NPM permissions
echo "Fixing NPM permissions..."
chown -R www-data:www-data /var/www/.npm 2>/dev/null || true
mkdir -p /var/www/.npm
chown -R www-data:www-data /var/www/.npm

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

# Ensure .env exists
if [ ! -f ".env" ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    chown www-data:www-data .env
fi

# Install dependencies and build
echo "Installing dependencies..."
sudo -u www-data npm cache clean --force
sudo -u www-data npm install --production=false

echo "Building application..."
sudo -u www-data npm run build

echo "Copying .env to build directory..."
sudo -u www-data cp .env build/.env

cd build
echo "Installing production dependencies in build directory..."
sudo -u www-data npm ci --omit="dev" --ignore-scripts
cd ..

# Create nginx directories if they don't exist
echo "Setting up nginx directories..."
mkdir -p /etc/nginx/sites-available
mkdir -p /etc/nginx/sites-enabled

# Remove default nginx site
rm -f /etc/nginx/sites-enabled/default

# Create temporary nginx config for certbot
echo "Creating temporary nginx config for SSL setup..."
cat > /etc/nginx/sites-available/$DOMAIN.temp << EOF
server {
    listen 80;
    server_name $DOMAIN;
    
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    
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
ln -sf /etc/nginx/sites-available/$DOMAIN.temp /etc/nginx/sites-enabled/$DOMAIN

# Test nginx configuration
if command_exists nginx; then
    nginx -t
    if [ $? -ne 0 ]; then
        echo "Nginx configuration error!"
        exit 1
    fi
    systemctl enable nginx
    systemctl restart nginx
else
    echo "Nginx installation failed!"
    exit 1
fi

# Install systemd service
echo "Installing systemd service..."
cp $SERVICE_NAME.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable $SERVICE_NAME
systemctl start $SERVICE_NAME

# Wait for service to start
echo "Waiting for service to start..."
sleep 10

# Check if service is running
if ! systemctl is-active --quiet $SERVICE_NAME; then
    echo "Service failed to start! Check logs:"
    journalctl -u $SERVICE_NAME --no-pager -n 20
    echo "Trying to restart service..."
    systemctl restart $SERVICE_NAME
    sleep 5
    if ! systemctl is-active --quiet $SERVICE_NAME; then
        echo "Service still not running. Please check configuration."
        exit 1
    fi
fi

# Create webroot for certbot
mkdir -p /var/www/html

# Get SSL certificate
echo "Getting SSL certificate..."
certbot certonly --webroot -w /var/www/html -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN

if [ $? -eq 0 ]; then
    echo "SSL certificate obtained successfully"
    
    # Replace with full nginx config
    echo "Installing full nginx configuration..."
    cp nginx.conf /etc/nginx/sites-available/$DOMAIN
    ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
    
    # Test and reload nginx
    nginx -t && systemctl reload nginx
else
    echo "SSL certificate generation failed. Using HTTP only configuration."
    # Keep the temporary config for HTTP only
fi

# Setup automatic certificate renewal
echo "Setting up automatic certificate renewal..."
(crontab -l 2>/dev/null | grep -v certbot; echo "0 12 * * * /usr/bin/certbot renew --quiet") | crontab -

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
if command_exists ufw; then
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw --force enable
fi

echo "=== Deployment Complete ==="
echo "Domain: https://$DOMAIN (or http://$DOMAIN if SSL failed)"
echo "Service: $SERVICE_NAME"
echo "Commands:"
echo "  systemctl status $SERVICE_NAME    - Check service status"
echo "  journalctl -u $SERVICE_NAME -f    - Follow service logs"
echo "  tail -f $APP_DIR/logs/*.log       - Follow app logs"
echo "  nginx -t                          - Test nginx config"
echo "  systemctl reload nginx            - Reload nginx"

# Final service status
echo ""
echo "Service Status:"
systemctl status $SERVICE_NAME --no-pager -l
