#!/bin/bash
# Before Install Script

# Update package manager
yum update -y

# Install Node.js if not already installed
if ! command -v node &> /dev/null; then
    curl -sL https://rpm.nodesource.com/setup_18.x | bash -
    yum install -y nodejs
fi

# Install PM2 globally
npm install -g pm2

# Create application directory
mkdir -p /var/www/ad-reporting

# Set permissions
chown -R ec2-user:ec2-user /var/www/ad-reporting
