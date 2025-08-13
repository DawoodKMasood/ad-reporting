// Common functions for integration management

window.integrationsHelper = {
  syncAccount: function(accountId) {
    if (confirm('Are you sure you want to sync this account? This may take a few moments.')) {
      const button = event.target.closest('button');
      const originalContent = button.innerHTML;
      button.disabled = true;
      button.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Syncing...';
      
      fetch(`/integrations/sync/${accountId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').getAttribute('content')
        }
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          window.location.reload();
        } else {
          alert('Failed to sync account: ' + (data.message || 'Unknown error'));
          button.disabled = false;
          button.innerHTML = originalContent;
        }
      })
      .catch(error => {
        console.error('Error:', error);
        alert('Failed to sync account. Please try again.');
        button.disabled = false;
        button.innerHTML = originalContent;
      });
    }
  },

  disconnectAccount: function(accountId, redirectTo = null) {
    if (confirm('Are you sure you want to disconnect this account? This will stop data synchronization.')) {
      const button = event.target.closest('button');
      const originalContent = button.innerHTML;
      button.disabled = true;
      button.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Disconnecting...';
      
      fetch(`/integrations/disconnect/${accountId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').getAttribute('content')
        }
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          if (redirectTo) {
            window.location.href = redirectTo;
          } else {
            window.location.reload();
          }
        } else {
          alert('Failed to disconnect account: ' + (data.message || 'Unknown error'));
          button.disabled = false;
          button.innerHTML = originalContent;
        }
      })
      .catch(error => {
        console.error('Error:', error);
        alert('Failed to disconnect account. Please try again.');
        button.disabled = false;
        button.innerHTML = originalContent;
      });
    }
  },

  connectPlatform: function(platformName) {
    const button = event.target;
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Connecting...';
    button.disabled = true;
    
    fetch('/integrations/connect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').getAttribute('content')
      },
      body: JSON.stringify({
        platform: platformName
      })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success && data.redirectUrl) {
        // Redirect to OAuth URL
        window.location.href = data.redirectUrl;
      } else {
        alert('Failed to initiate connection: ' + (data.message || 'Unknown error'));
        button.innerHTML = originalText;
        button.disabled = false;
      }
    })
    .catch(error => {
      console.error('Error:', error);
      alert('Failed to connect platform. Please try again.');
      button.innerHTML = originalText;
      button.disabled = false;
    });
  }
};

// Provide global functions for backward compatibility
window.syncAccount = window.integrationsHelper.syncAccount;
window.disconnectAccount = window.integrationsHelper.disconnectAccount;
window.connectPlatform = window.integrationsHelper.connectPlatform;
