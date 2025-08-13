#!/bin/bash

# SSL Certificate Renewal Script
# Run this monthly via cron: 0 2 1 * * /path/to/ssl-renew.sh

DOMAIN="aiden.webredirect.org"
SERVICE_NAME="ad-reporting"

echo "Renewing SSL certificate for $DOMAIN..."

# Renew certificate
certbot renew --quiet

# Check if renewal was successful
if [ $? -eq 0 ]; then
    echo "Certificate renewed successfully"
    
    # Reload nginx
    systemctl reload nginx
    
    # Log success
    echo "$(date): SSL certificate renewed for $DOMAIN" >> /var/log/ssl-renewal.log
else
    echo "Certificate renewal failed"
    echo "$(date): SSL certificate renewal FAILED for $DOMAIN" >> /var/log/ssl-renewal.log
    
    # Send notification (optional)
    # mail -s "SSL Certificate Renewal Failed" admin@$DOMAIN < /dev/null
fi
