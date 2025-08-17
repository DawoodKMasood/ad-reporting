/**
 * Integration Management Module
 * Handles all JavaScript functionality for integration management
 */

class IntegrationManager {
  constructor() {
    this.init()
  }

  init() {
    this.bindEvents()
    this.initializeTooltips()
  }

  bindEvents() {
    // Bind sync button events
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="sync-account"]')) {
        e.preventDefault()
        const button = e.target.closest('[data-action="sync-account"]')
        this.syncAccount(button)
      }

      if (e.target.closest('[data-action="disconnect-account"]')) {
        e.preventDefault()
        const button = e.target.closest('[data-action="disconnect-account"]')
        this.disconnectAccount(button)
      }

      if (e.target.closest('[data-action="connect-platform"]')) {
        e.preventDefault()
        const button = e.target.closest('[data-action="connect-platform"]')
        this.connectPlatform(button)
      }

      if (e.target.closest('[data-action="rename-account"]')) {
        e.preventDefault()
        const button = e.target.closest('[data-action="rename-account"]')
        this.renameAccount(button)
      }
    })

    // Handle rename form submission
    document.addEventListener('submit', (e) => {
      if (e.target.id === 'renameAccountForm') {
        e.preventDefault()
        this.handleRenameAccountForm(e.target)
      }
    })

    // Handle form submissions
    document.addEventListener('submit', (e) => {
      if (e.target.id === 'syncForm') {
        e.preventDefault()
        this.handleSyncForm(e.target)
      }

      if (e.target.id === 'disconnectForm') {
        e.preventDefault()
        this.handleDisconnectForm(e.target)
      }
    })
  }

  syncAccount(button) {
    const accountId = button.dataset.accountId
    const url = `/integrations/sync/${accountId}`

    // Show loading state
    const originalText = button.innerHTML
    button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Syncing...'
    button.disabled = true

    // Make API request
    fetch(url, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').getAttribute('content'),
      },
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          this.showNotification('Sync completed successfully!', 'success')
          // Reload page to show updated data
          setTimeout(() => {
            location.reload()
          }, 1500)
        } else {
          this.showNotification('Sync failed: ' + data.message, 'error')
        }
      })
      .catch((error) => {
        this.showNotification('Sync failed: ' + error.message, 'error')
      })
      .finally(() => {
        // Restore button state
        button.innerHTML = originalText
        button.disabled = false
      })
  }

  disconnectAccount(button) {
    const accountId = button.dataset.accountId

    if (
      !confirm(
        'Are you sure you want to disconnect this account? This will remove all associated data.'
      )
    ) {
      return
    }

    const url = `/integrations/disconnect/${accountId}`

    // Show loading state
    const originalText = button.innerHTML
    button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Disconnecting...'
    button.disabled = true

    // Make API request
    fetch(url, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').getAttribute('content'),
      },
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          this.showNotification('Account disconnected successfully!', 'success')
          // Redirect to integrations page
          setTimeout(() => {
            window.location.href = '/integrations'
          }, 1500)
        } else {
          this.showNotification('Disconnect failed: ' + data.message, 'error')
          // Restore button state
          button.innerHTML = originalText
          button.disabled = false
        }
      })
      .catch((error) => {
        this.showNotification('Disconnect failed: ' + error.message, 'error')
        // Restore button state
        button.innerHTML = originalText
        button.disabled = false
      })
  }

  connectPlatform(button) {
    const platform = button.dataset.platform

    if (button.disabled) {
      return
    }

    const url = `/integrations/connect/${platform}`
    console.log('Connecting to platform:', platform, 'URL:', url)
    console.log('connectPlatform called', platform, url)

    // Show loading state
    const originalText = button.innerHTML
    button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Connecting...'
    button.disabled = true

    // Make API request
    fetch(url, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').getAttribute('content'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ platform: platform }),
    })
      .then((response) => {
        console.log('Response received:', response)
        return response.json()
      })
      .then((data) => {
        console.log('Data received:', data)
        if (data.success && data.redirectUrl) {
          this.showNotification('Redirecting to platform authorization...', 'success')
          // Redirect to platform authorization URL
          setTimeout(() => {
            window.location.href = data.redirectUrl
          }, 1500)
        } else if (data.success && data.accounts) {
          // Handle multiple accounts connected
          this.showNotification(
            `${data.accounts.length} account(s) connected successfully!`,
            'success'
          )

          // Show account selection modal if multiple accounts
          if (data.accounts.length > 1) {
            setTimeout(() => {
              this.showAccountSelection(data.accounts)
            }, 1500)
          } else {
            // Redirect to integrations page
            setTimeout(() => {
              window.location.href = '/integrations'
            }, 1500)
          }
        } else if (data.error) {
          this.showNotification('Connection failed: ' + data.message, 'error')
          // Restore button state
          button.innerHTML = originalText
          button.disabled = false
        } else {
          this.showNotification('Connection failed: Unknown error', 'error')
          // Restore button state
          button.innerHTML = originalText
          button.disabled = false
        }
      })
      .catch((error) => {
        console.error('Connection failed:', error)
        this.showNotification('Connection failed: ' + error.message, 'error')
        // Restore button state
        button.innerHTML = originalText
        button.disabled = false
      })
  }

  renameAccount(button) {
    const accountId = button.dataset.accountId
    const currentName = button.dataset.currentName || ''

    // Show rename modal
    const modal = document.getElementById('renameAccountModal')
    if (modal) {
      // Set current name in input
      const input = document.getElementById('renameAccountModal-input')
      if (input) {
        input.value = currentName
        input.dataset.currentName = currentName
        input.dataset.accountId = accountId
      }

      // Show modal
      if (typeof window.renameAccountModal_show === 'function') {
        window.renameAccountModal_show()
      }
    }
  }

  handleRenameAccountForm(form) {
    const formData = new FormData(form)
    const accountId = formData.get('accountId')
    const newName = formData.get('accountName')
    const currentName = formData.get('currentName')

    if (!newName || newName === currentName) {
      return
    }

    const url = `/integrations/${accountId}/name`

    // Show loading state
    const button = form.querySelector('button[type="submit"]')
    const originalText = button.innerHTML
    button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Renaming...'
    button.disabled = true

    // Make API request
    fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').getAttribute('content'),
      },
      body: JSON.stringify({ displayName: newName }),
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          this.showNotification('Account name updated successfully!', 'success')
          // Reload page to show updated data
          setTimeout(() => {
            location.reload()
          }, 1500)
        } else {
          this.showNotification('Rename failed: ' + data.message, 'error')
        }
      })
      .catch((error) => {
        this.showNotification('Rename failed: ' + error.message, 'error')
      })
      .finally(() => {
        // Restore button state
        button.innerHTML = originalText
        button.disabled = false
      })
  }

  handleSyncForm(form) {
    const url = form.action
    const formData = new FormData(form)

    // Show loading state
    const button = form.querySelector('button[type="submit"]')
    const originalText = button.innerHTML
    button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Syncing...'
    button.disabled = true

    // Make API request
    fetch(url, {
      method: 'POST',
      body: formData,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
      },
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          this.showNotification('Sync completed successfully!', 'success')
          // Reload page to show updated data
          setTimeout(() => {
            location.reload()
          }, 1500)
        } else {
          this.showNotification('Sync failed: ' + data.message, 'error')
        }
      })
      .catch((error) => {
        this.showNotification('Sync failed: ' + error.message, 'error')
      })
      .finally(() => {
        // Restore button state
        button.innerHTML = originalText
        button.disabled = false
      })
  }

  handleDisconnectForm(form) {
    if (
      !confirm(
        'Are you sure you want to disconnect this account? This will remove all associated data.'
      )
    ) {
      return
    }

    const url = form.action
    const formData = new FormData(form)

    // Show loading state
    const button = form.querySelector('button[type="submit"]')
    const originalText = button.innerHTML
    button.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Disconnecting...'
    button.disabled = true

    // Make API request
    fetch(url, {
      method: 'POST',
      body: formData,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
      },
    })
      .then((response) => response.json())
      .then((data) => {
        if (data.success) {
          this.showNotification('Account disconnected successfully!', 'success')
          // Redirect to integrations page
          setTimeout(() => {
            window.location.href = '/integrations'
          }, 1500)
        } else {
          this.showNotification('Disconnect failed: ' + data.message, 'error')
          // Restore button state
          button.innerHTML = originalText
          button.disabled = false
        }
      })
      .catch((error) => {
        this.showNotification('Disconnect failed: ' + error.message, 'error')
        // Restore button state
        button.innerHTML = originalText
        button.disabled = false
      })
  }

  showNotification(message, type = 'info') {
    console.log('showNotification called', message, type)
    // Create notification element
    const notification = document.createElement('div')
    notification.className = `fixed top-4 left-1/2 transform -translate-x-1/2 px-6 py-4 rounded-lg shadow-lg z-50 max-w-md transition-opacity duration-300 ${
      type === 'success'
        ? 'bg-green-50 border border-green-200 text-green-800'
        : type === 'error'
          ? 'bg-red-50 border border-red-200 text-red-800'
          : 'bg-blue-50 border border-blue-200 text-blue-800'
    }`
    notification.innerHTML = `
      <div class="flex items-center">
        <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'} mr-3 ${
          type === 'success'
            ? 'text-green-600'
            : type === 'error'
              ? 'text-red-600'
              : 'text-blue-600'
        }" aria-hidden="true"></i>
        <span class="font-medium">${message}</span>
      </div>
    `

    // Add to DOM
    document.body.appendChild(notification)

    // Auto-hide after 5 seconds
    setTimeout(() => {
      notification.style.transition = 'opacity 0.5s ease-out'
      notification.style.opacity = '0'
      setTimeout(() => notification.remove(), 500)
    }, 5000)
  }

  initializeTooltips() {
    // Initialize any tooltips if needed
    // This is a placeholder for future tooltip implementation
  }

  formatCustomerId(customerId) {
    if (!customerId || customerId.length !== 10) {
      return customerId
    }
    return `${customerId.slice(0, 3)}-${customerId.slice(3, 6)}-${customerId.slice(6)}`
  }

  showAccountSelection(accounts) {
    // Create account selection modal
    const modal = document.createElement('div')
    modal.className = 'fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50'
    modal.innerHTML = `
      <div class="relative top-20 mx-auto p-5 border w-11/12 max-w-lg shadow-lg rounded-md bg-white">
        <div class="mt-3">
          <h3 class="text-lg font-medium text-gray-900 text-center mb-4">
            <i class="fas fa-check-circle text-green-600 mr-2"></i>
            Multiple Google Ads Accounts Found
          </h3>
          <div class="mt-4">
            <p class="text-sm text-gray-500 mb-4">We found ${accounts.length} Google Ads accounts. All accounts have been connected successfully.</p>
            <div class="space-y-3 max-h-64 overflow-y-auto">
              ${accounts
                .map(
                  (account) => `
                <div class="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                  <div class="flex-1">
                    <h4 class="text-sm font-medium text-gray-900">${account.accountName || 'Account ' + this.formatCustomerId(account.accountId)}</h4>
                    <p class="text-xs text-gray-500">ID: ${this.formatCustomerId(account.accountId)}</p>
                    ${account.isTestAccount ? '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 mt-1"><i class="fas fa-flask mr-1"></i>Test Account</span>' : ''}
                    ${account.isManagerAccount ? '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 mt-1 ml-2"><i class="fas fa-users mr-1"></i>Manager Account</span>' : ''}
                  </div>
                  <i class="fas fa-check-circle text-green-600"></i>
                </div>
              `
                )
                .join('')}
            </div>
          </div>
          <div class="items-center px-4 py-3 mt-4">
            <button id="closeAccountModal" class="px-4 py-2 bg-blue-500 text-white text-base font-medium rounded-md w-full shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300">
              Continue to Dashboard
            </button>
          </div>
        </div>
      </div>
    `

    document.body.appendChild(modal)

    // Handle close modal
    document.getElementById('closeAccountModal').addEventListener('click', () => {
      modal.remove()
      window.location.href = '/integrations'
    })

    // Close on background click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove()
        window.location.href = '/integrations'
      }
    })
  }
}

// Global functions for backward compatibility
window.syncAccount = function (accountId) {
  const button = document.querySelector(`[data-account-id="${accountId}"]`)
  if (button && window.integrationManager) {
    window.integrationManager.syncAccount(button)
  }
}

window.disconnectAccount = function (accountId) {
  const button = document.querySelector(
    `[data-account-id="${accountId}"][data-action="disconnect-account"]`
  )
  if (button && window.integrationManager) {
    window.integrationManager.disconnectAccount(button)
  }
}

// Initialize the integration manager when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.integrationManager = new IntegrationManager()
})

export default IntegrationManager
