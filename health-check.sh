#!/bin/bash

# Health Check Script for Ad Reporting Application

DOMAIN="aiden.webredirect.org"
APP_URL="https://$DOMAIN"
SERVICE_NAME="ad-reporting"

echo "=== Health Check Report ==="
echo "Date: $(date)"
echo "Domain: $DOMAIN"
echo

# Check service status
echo "1. Service Status:"
if systemctl is-active --quiet $SERVICE_NAME; then
    echo "   ✓ Service is running"
else
    echo "   ✗ Service is not running"
    echo "   Last logs:"
    journalctl -u $SERVICE_NAME --no-pager -n 5
fi
echo

# Check nginx status
echo "2. Nginx Status:"
if systemctl is-active --quiet nginx; then
    echo "   ✓ Nginx is running"
else
    echo "   ✗ Nginx is not running"
fi
echo

# Check SSL certificate
echo "3. SSL Certificate:"
SSL_EXPIRY=$(echo | openssl s_client -servername $DOMAIN -connect $DOMAIN:443 2>/dev/null | openssl x509 -noout -dates | grep notAfter | cut -d= -f2)
if [ ! -z "$SSL_EXPIRY" ]; then
    echo "   ✓ SSL certificate expires: $SSL_EXPIRY"
else
    echo "   ✗ SSL certificate check failed"
fi
echo

# Check HTTP response
echo "4. HTTP Response:"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" $APP_URL)
if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✓ Application responding (HTTP $HTTP_CODE)"
else
    echo "   ✗ Application not responding properly (HTTP $HTTP_CODE)"
fi
echo

# Check disk space
echo "5. Disk Space:"
df -h /var/www/ad-reporting | tail -n 1 | awk '{print "   Used: " $3 " / " $2 " (" $5 ")"}'
echo

# Check memory usage
echo "6. Memory Usage:"
free -h | grep "Mem:" | awk '{print "   Used: " $3 " / " $2}'
echo

# Check recent logs for errors
echo "7. Recent Errors:"
ERROR_COUNT=$(journalctl -u $SERVICE_NAME --since "1 hour ago" | grep -i error | wc -l)
if [ "$ERROR_COUNT" -eq 0 ]; then
    echo "   ✓ No errors in the last hour"
else
    echo "   ⚠ $ERROR_COUNT errors in the last hour"
fi

echo
echo "=== End Health Check ==="
