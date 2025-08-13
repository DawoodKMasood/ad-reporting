#!/bin/bash

echo "=== Setting Script Permissions ==="

# Make all shell scripts executable
chmod +x *.sh

# List the scripts with their permissions
echo "Script permissions:"
ls -la *.sh

echo "All scripts are now executable!"
echo ""
echo "Available scripts:"
echo "  ./deploy.sh              - Full production deployment"
echo "  ./start-production.sh    - Start server"
echo "  ./stop-production.sh     - Stop server"
echo "  ./restart-production.sh  - Restart server"
echo "  ./update-production.sh   - Update and restart"
echo "  ./start-production-pm2.sh- Start with PM2"
echo "  ./fix-permissions.sh     - Fix NPM permissions (sudo)"
echo "  ./health-check.sh        - Health check"
echo "  ./ssl-renew.sh           - Renew SSL certificate"
