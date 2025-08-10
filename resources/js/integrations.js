/**
 * Integration Management Module
 * Handles all JavaScript functionality for integration management
 */

class IntegrationManager {
  constructor() {
    this.init();
  }

  init() {
    this.bindEvents();
    this.initializeTooltips();
  }

  bindEvents() {
    // Bind sync button events
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="sync-account"]')) {
        e.preventDefault();
        const button = e.target.closest('[data-action="sync-account"]');
        this.syncAccount(button);
      }
      
      if (e.target.closest('[data-action="disconnect-account"]')) {
        e.preventDefault();
        const button = e.target.closest('[data-action="disconnect-account"]');
        this.disconnectAccount(button);
      }
      
      if (e.target.closest('[data-action="connect-platform"]')) {
        e.preventDefault();
        const button = e.target.closest('[data-action="connect-platform"]');
        this.connectPlatform(button);
      }
    });
    
    // Handle form submissions
    document.addEventListener('submit', (e) => {
      if (e.target.id === 'syncForm') {
        e.preventDefault();
        this.handleSyncForm(e.target);
      }
      
      if (e.target.id === 'disconnectForm') {
        e.preventDefault();
        this.handleDisconnectForm(e.target);
      }
    });
  }

  syncAccount(button) {
    const accountId = button.dataset.accountId;
    const url = `/integrations/sync/${accountId}`;
    
    // Show loading state
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Syncing...';
    button.disabled = true;
    
    // Make API request
    fetch(url, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').getAttribute('content')
      }
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        this.showNotification('Sync completed successfully!', 'success');
        // Reload page to show updated data
        setTimeout(() => {
          location.reload();
        }, 1500);
      } else {
        this.showNotification('Sync failed: ' + data.message, 'error');
      }
    })
    .catch(error => {
      this.showNotification('Sync failed: ' + error.message, 'error');
    })
    .finally(() => {
      // Restore button state
      button.innerHTML = originalText;
      button.disabled = false;
    });
  }

  disconnectAccount(button) {
    const accountId = button.dataset.accountId;
    
    if (!confirm('Are you sure you want to disconnect this account? This will remove all associated data.')) {
      return;
    }
    
    const url = `/integrations/disconnect/${accountId}`;
    
    // Show loading state
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Disconnecting...';
    button.disabled = true;
    
    // Make API request
    fetch(url, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').getAttribute('content')
      }
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        this.showNotification('Account disconnected successfully!', 'success');
        // Redirect to integrations page
        setTimeout(() => {
          window.location.href = '/integrations';
        }, 1500);
      } else {
        this.showNotification('Disconnect failed: ' + data.message, 'error');
        // Restore button state
        button.innerHTML = originalText;
        button.disabled = false;
      }
    })
    .catch(error => {
      this.showNotification('Disconnect failed: ' + error.message, 'error');
      // Restore button state
      button.innerHTML = originalText;
      button.disabled = false;
    });
  }

  connectPlatform(button) {
    const platform = button.dataset.platform;
    
    if (button.disabled) {
      return;
    }
    
    const url = `/integrations/connect/${platform}`;
    
    // Show loading state
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Connecting...';
    button.disabled = true;
    
    // Make API request
    fetch(url, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').getAttribute('content'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ platform: platform })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success && data.redirectUrl) {
        this.showNotification('Redirecting to platform authorization...', 'success');
        // Redirect to platform authorization URL
        setTimeout(() => {
          window.location.href = data.redirectUrl;
        }, 1500);
      } else if (data.error) {
        this.showNotification('Connection failed: ' + data.message, 'error');
        // Restore button state
        button.innerHTML = originalText;
        button.disabled = false;
      } else {
        this.showNotification('Connection failed: Unknown error', 'error');
        // Restore button state
        button.innerHTML = originalText;
        button.disabled = false;
      }
    })
    .catch(error => {
      this.showNotification('Connection failed: ' + error.message, 'error');
      // Restore button state
      button.innerHTML = originalText;
      button.disabled = false;
    });
  }

  handleSyncForm(form) {
    const url = form.action;
    const formData = new FormData(form);
    
    // Show loading state
    const button = form.querySelector('button[type="submit"]');
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Syncing...';
    button.disabled = true;
    
    // Make API request
    fetch(url, {
      method: 'POST',
      body: formData,
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        this.showNotification('Sync completed successfully!', 'success');
        // Reload page to show updated data
        setTimeout(() => {
          location.reload();
        }, 1500);
      } else {
        this.showNotification('Sync failed: ' + data.message, 'error');
      }
    })
    .catch(error => {
      this.showNotification('Sync failed: ' + error.message, 'error');
    })
    .finally(() => {
      // Restore button state
      button.innerHTML = originalText;
      button.disabled = false;
    });
  }

  handleDisconnectForm(form) {
    if (!confirm('Are you sure you want to disconnect this account? This will remove all associated data.')) {
      return;
    }
    
    const url = form.action;
    const formData = new FormData(form);
    
    // Show loading state
    const button = form.querySelector('button[type="submit"]');
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Disconnecting...';
    button.disabled = true;
    
    // Make API request
    fetch(url, {
      method: 'POST',
      body: formData,
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        this.showNotification('Account disconnected successfully!', 'success');
        // Redirect to integrations page
        setTimeout(() => {
          window.location.href = '/integrations';
        }, 1500);
      } else {
        this.showNotification('Disconnect failed: ' + data.message, 'error');
        // Restore button state
        button.innerHTML = originalText;
        button.disabled = false;
      }
    })
    .catch(error => {
      this.showNotification('Disconnect failed: ' + error.message, 'error');
      // Restore button state
      button.innerHTML = originalText;
      button.disabled = false;
    });
  }

  showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `fixed top-4 left-1/2 transform -translate-x-1/2 px-6 py-4 rounded-lg shadow-lg z-50 max-w-md transition-opacity duration-300 ${
      type === 'success' ? 'bg-green-50 border border-green-200 text-green-800' : 
      type === 'error' ? 'bg-red-50 border border-red-200 text-red-800' : 
      'bg-blue-50 border border-blue-200 text-blue-800'
    }`;
    notification.innerHTML = `
      <div class="flex items-center">
        <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'} mr-3 ${
          type === 'success' ? 'text-green-600' : type === 'error' ? 'text-red-600' : 'text-blue-600'
        }" aria-hidden="true"></i>
        <span class="font-medium">${message}</span>
      </div>
    `;
    
    // Add to DOM
    document.body.appendChild(notification);
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      notification.style.transition = "opacity 0.5s ease-out";
      notification.style.opacity = "0";
      setTimeout(() => notification.remove(), 500);
    }, 5000);
  }

  initializeTooltips() {
    // Initialize any tooltips if needed
    // This is a placeholder for future tooltip implementation
  }
}

// Initialize the integration manager when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.integrationManager = new IntegrationManager();
});

export default IntegrationManager;