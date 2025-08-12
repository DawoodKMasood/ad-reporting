#!/bin/bash
# Setup swap file for build process

echo "Setting up swap file..."

# Check if swap already exists
if swapon --show | grep -q swap; then
    echo "Swap already exists"
    exit 0
fi

# Create 2GB swap file
sudo fallocate -l 2G /swapfile

# Set permissions
sudo chmod 600 /swapfile

# Make swap
sudo mkswap /swapfile

# Enable swap
sudo swapon /swapfile

# Add to fstab for persistence
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Set swappiness
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf

echo "Swap file created and enabled"
free -h
