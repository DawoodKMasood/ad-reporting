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

# Stop existing service and kill processes on port 3333
echo "Stopping existing services and processes..."
systemctl stop $SERVICE_NAME 2>/dev/null || true
pkill -f "node.*server.js" 2>/dev/null || true
sleep 2

# Kill any remaining processes on port 3333
PIDS=$(lsof -ti:3333 2>/dev/null || true)
if [ ! -z "$PIDS" ]; then
    echo "Killing processes on port 3333: $PIDS"
    kill -9 $PIDS 2>/dev/null || true
    sleep 2
fi

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
apt install -y nginx certbot python3-certbot-nginx git curl lsof

# Fix NPM permissions
echo "Fixing NPM permissions..."
chown -R www-data:www-data /var/www/.npm 2>/dev/null || true
mkdir -p /var/www/.npm
chown -R www-data:www-data /var/www/.npm

# Create application directory
echo "Creating application directory..."
mkdir -p $APP_DIR
mkdir -p $APP_DIR/logs

# Copy application files (including hidden files)
echo "Copying application files..."
shopt -s dotglob
cp -r ./* $APP_DIR/
shopt -u dotglob
cd $APP_DIR

# Set ownership
echo "Setting ownership..."
chown -R www-data:www-data $APP_DIR

# Verify .env file exists
echo "Checking for .env file..."
if [ -f ".env" ]; then
    echo "✓ .env file found"
elif [ -f ".env.example" ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    chown www-data:www-data .env
    echo "✓ .env created from example"
else
    echo "Error: No .env or .env.example file found!"
    echo "Contents of current directory:"
    ls -la
    exit 1
fi

# Fix PORT in .env file (must be 3333, not 80)
echo "Fixing PORT in .env file..."
sed -i 's/^PORT=.*/PORT=3333/' .env
chown www-data:www-data .env

# Install dependencies and build
echo "Installing dependencies..."
sudo -u www-data npm cache clean --force
sudo -u www-data npm install

echo "Building application..."
sudo -u www-data npm run build

# Verify build completed successfully
if [ ! -d "build" ] || [ ! -f "build/bin/server.js" ]; then
    echo "Error: Build failed or server.js not found!"
    echo "Build directory contents:"
    ls -la build/ 2>/dev/null || echo "Build directory does not exist"
    exit 1
fi

# Copy .env to build directory and fix PORT there too
echo "Copying .env to build directory..."
cp .env build/.env
sed -i 's/^PORT=.*/PORT=3333/' build/.env
chown www-data:www-data build/.env

cd build
echo "Installing production dependencies..."
sudo -u www-data npm ci --omit="dev" --ignore-scripts

# Quick test to ensure port 3333 is free
echo "Verifying port 3333 is available..."
if lsof -Pi :3333 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "Error: Port 3333 is still in use!"
    lsof -Pi :3333 -sTCP:LISTEN
    exit 1
fi

cd $APP_DIR

# Create systemd service
echo "Creating systemd service..."
cat > /etc/systemd/system/$SERVICE_NAME.service << EOF
[Unit]
Description=Ad Reporting AdonisJS Application
After=network.target
Wants=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=$APP_DIR/build
ExecStart=/usr/bin/node bin/server.js
Restart=always
RestartSec=10
EnvironmentFile=$APP_DIR/build/.env
Environment=NODE_ENV=production
Environment=PORT=3333
Environment=HOST=0.0.0.0
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ad-reporting
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable $SERVICE_NAME
systemctl start $SERVICE_NAME

# Wait and check service
echo "Starting service and waiting for startup..."
sleep 15

if ! systemctl is-active --quiet $SERVICE_NAME; then
    echo "Service failed to start! Full logs:"
    journalctl -u $SERVICE_NAME --no-pager -n 50
    echo ""
    echo "Checking .env file in build directory:"
    echo "PORT setting: $(grep '^PORT=' build/.env || echo 'PORT not found')"
    echo ""
    echo "Service status:"
    systemctl status $SERVICE_NAME --no-pager
    exit 1
else
    echo "✓ Service started successfully!"
    
    # Test if the service is responding
    echo "Testing service response..."
    sleep 5
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/ | grep -q "200\|404\|302"; then
        echo "✓ Service is responding to HTTP requests"
    else
        echo "⚠ Service started but not responding to HTTP requests yet"
    fi
fi

# Setup nginx directories
mkdir -p /etc/nginx/sites-available
mkdir -p /etc/nginx/sites-enabled
rm -f /etc/nginx/sites-enabled/default

# Create final HTTPS nginx config
echo "Creating HTTPS nginx configuration..."
cat > /etc/nginx/sites-available/$DOMAIN << EOF
server {
    listen 80;
    server_name $DOMAIN;
    
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    
    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_trusted_certificate /etc/letsencrypt/live/$DOMAIN/chain.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-SHA384;
    ssl_prefer_server_ciphers on;
    ssl_session_timeout 10m;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;
    ssl_stapling on;
    ssl_stapling_verify on;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload";
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";

    access_log /var/log/nginx/$DOMAIN.access.log;
    error_log /var/log/nginx/$DOMAIN.error.log;

    root $APP_DIR/build/public;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied expired no-cache no-store private must-revalidate auth;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml+rss application/atom+xml image/svg+xml;

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)\$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files \$uri @proxy;
    }

    location / {
        try_files \$uri @proxy;
    }

    location @proxy {
        proxy_pass http://127.0.0.1:3333;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_redirect off;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location ~ /\.ht {
        deny all;
    }

    location ~ /\. {
        deny all;
    }
}
EOF

# Temporary HTTP-only config for SSL certificate generation
echo "Creating temporary HTTP configuration for SSL setup..."
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

# Start with temporary HTTP config
echo "Setting up nginx with temporary HTTP configuration..."
ln -sf /etc/nginx/sites-available/$DOMAIN.temp /etc/nginx/sites-enabled/$DOMAIN
systemctl enable nginx

# Test nginx config
if ! nginx -t; then
    echo "Nginx configuration test failed!"
    exit 1
fi

systemctl restart nginx

# Prepare for SSL certificate
mkdir -p /var/www/html
chown -R www-data:www-data /var/www/html

# Check domain DNS resolution
echo "Checking domain DNS resolution..."
if ! nslookup $DOMAIN > /dev/null 2>&1; then
    echo "WARNING: Domain $DOMAIN does not resolve to this server!"
    echo "Please ensure your domain points to this server's IP address before SSL will work."
    echo "Current server IP addresses:"
    hostname -I
    echo "You can still access the site via HTTP, but HTTPS will not work until DNS is configured."
fi

# Try to get SSL certificate
echo "Attempting to get SSL certificate for $DOMAIN..."
sleep 5  # Give nginx time to start properly

# Stop nginx temporarily for standalone mode
systemctl stop nginx

# Try standalone mode first (more reliable)
if certbot certonly --standalone -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN; then
    echo "✓ SSL certificate obtained successfully with standalone mode!"
    SSL_SUCCESS=true
else
    echo "Standalone SSL failed, trying webroot mode..."
    systemctl start nginx
    sleep 3
    
    if certbot certonly --webroot -w /var/www/html -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN; then
        echo "✓ SSL certificate obtained successfully with webroot mode!"
        SSL_SUCCESS=true
    else
        echo "⚠ SSL certificate generation failed!"
        echo "SSL Error details:"
        tail -20 /var/log/letsencrypt/letsencrypt.log 2>/dev/null || echo "No SSL logs found"
        SSL_SUCCESS=false
    fi
fi

# Start nginx if it's not running
systemctl start nginx

# Switch to appropriate config based on SSL success
if [ "$SSL_SUCCESS" = true ]; then
    echo "Switching to HTTPS configuration..."
    ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
    
    # Test the SSL configuration
    if nginx -t; then
        systemctl reload nginx
        echo "✓ HTTPS configuration activated successfully!"
        
        # Test HTTPS
        sleep 3
        if curl -k -s -o /dev/null -w "%{http_code}" https://$DOMAIN/ | grep -q "200\|404\|302"; then
            echo "✓ HTTPS is working!"
        else
            echo "⚠ HTTPS configuration applied but not responding yet"
        fi
    else
        echo "⚠ HTTPS configuration has errors, reverting to HTTP"
        ln -sf /etc/nginx/sites-available/$DOMAIN.temp /etc/nginx/sites-enabled/$DOMAIN
        systemctl reload nginx
    fi
else
    echo "Keeping HTTP-only configuration until SSL certificate is available"
    echo "To retry SSL later, run:"
    echo "  sudo certbot certonly --standalone -d $DOMAIN"
    echo "  sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN"
    echo "  sudo nginx -t && sudo systemctl reload nginx"
fi

# Setup certificate renewal regardless
echo "Setting up automatic certificate renewal..."
(crontab -l 2>/dev/null | grep -v certbot; echo "0 12 * * * /usr/bin/certbot renew --quiet && systemctl reload nginx") | crontab -

# Setup firewall
echo "Configuring firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo ""
echo "=== Deployment Complete ==="
echo "Domain: $DOMAIN"
echo "Service: $SERVICE_NAME"

if [ "$SSL_SUCCESS" = true ]; then
    echo "✓ HTTPS: https://$DOMAIN"
    echo "✓ HTTP redirects to HTTPS"
else
    echo "⚠ HTTP only: http://$DOMAIN"
    echo "⚠ HTTPS not available - check DNS configuration"
fi

echo ""
echo "Management commands:"
echo "  systemctl status $SERVICE_NAME    - Check service status"
echo "  journalctl -u $SERVICE_NAME -f    - Follow service logs"
echo "  nginx -t                          - Test nginx config"
echo "  systemctl reload nginx            - Reload nginx"
echo "  certbot certificates              - Check SSL certificates"

echo ""
systemctl status $SERVICE_NAME --no-pager
