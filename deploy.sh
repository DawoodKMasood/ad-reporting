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

# Ensure .env exists in root
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        echo "Creating .env from .env.example..."
        cp .env.example .env
    else
        echo "Error: No .env or .env.example file found!"
        exit 1
    fi
fi
chown www-data:www-data .env

# Install dependencies and build
echo "Installing dependencies..."
sudo -u www-data npm cache clean --force
sudo -u www-data npm install

echo "Building application..."
sudo -u www-data npm run build

# Copy .env to build directory
echo "Copying .env to build directory..."
cp .env build/.env
chown www-data:www-data build/.env

cd build
echo "Installing production dependencies..."
sudo -u www-data npm ci --omit="dev" --ignore-scripts
cd ..

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
sleep 10
if ! systemctl is-active --quiet $SERVICE_NAME; then
    echo "Service failed to start! Logs:"
    journalctl -u $SERVICE_NAME --no-pager -n 20
    exit 1
fi

# Setup nginx directories
mkdir -p /etc/nginx/sites-available
mkdir -p /etc/nginx/sites-enabled
rm -f /etc/nginx/sites-enabled/default

# Create nginx config
echo "Setting up nginx..."
cat > /etc/nginx/sites-available/$DOMAIN << EOF
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$server_name\$request_uri;
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

# Temporary HTTP config for SSL setup
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

# Use temp config first
ln -sf /etc/nginx/sites-available/$DOMAIN.temp /etc/nginx/sites-enabled/$DOMAIN
systemctl enable nginx
nginx -t && systemctl restart nginx

# Get SSL certificate
mkdir -p /var/www/html
echo "Getting SSL certificate..."
certbot certonly --webroot -w /var/www/html -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN

if [ $? -eq 0 ]; then
    echo "SSL certificate obtained, switching to HTTPS config..."
    ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
    nginx -t && systemctl reload nginx
else
    echo "SSL failed, keeping HTTP config"
fi

# Setup certificate renewal
(crontab -l 2>/dev/null | grep -v certbot; echo "0 12 * * * /usr/bin/certbot renew --quiet") | crontab -

# Setup firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "=== Deployment Complete ==="
echo "Domain: https://$DOMAIN"
echo "Service: $SERVICE_NAME"
echo "Check status: systemctl status $SERVICE_NAME"
echo "Check logs: journalctl -u $SERVICE_NAME -f"

systemctl status $SERVICE_NAME --no-pager
