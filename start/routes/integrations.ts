import router from '@adonisjs/core/services/router'
const { middleware } = await import('#start/kernel')

const IntegrationsController = () => import('#controllers/integrations_controller')

// Protected integrations routes
router
  .group(() => {
    router.get('/', [IntegrationsController, 'index']).as('integrations.index')

    // Simple account route without controller dependency for now
    router.get('/accounts', async ({ auth, response }) => {
      try {
        console.log('🟢 /integrations/accounts route hit');
        const user = auth.getUserOrFail()
        
        // Import the model directly here to avoid dependency issues
        const { default: ConnectedAccount } = await import('#models/connected_account')
        
        const connectedAccounts = await ConnectedAccount.query()
          .where('user_id', user.id)
          .where('platform', 'google_ads')
          .where('is_active', true)
          .orderBy('created_at', 'desc')
        
        console.log('🟢 Found accounts:', connectedAccounts.length);
        
        const formattedAccounts = connectedAccounts.map(account => ({
          id: account.id,
          accountId: account.accountId,
          formattedAccountId: account.accountId.length === 10 ? 
            `${account.accountId.slice(0, 3)}-${account.accountId.slice(3, 6)}-${account.accountId.slice(6)}` : 
            account.accountId,
          displayName: account.accountName || `Account ${account.accountId}`,
          accountName: account.accountName,
          isTestAccount: account.isTestAccount || false,
          isManagerAccount: account.isManagerAccount || false,
          accountTimezone: account.accountTimezone || 'UTC',
          lastSyncAt: account.lastSyncAt,
          isActive: account.isActive
        }))
        
        return response.json({
          success: true,
          accounts: formattedAccounts
        })
      } catch (error) {
        console.error('🔴 Error in /integrations/accounts:', error);
        return response.badRequest({
          error: 'Failed to fetch accounts',
          message: error.message
        })
      }
    }).as('integrations.accounts')
    
    // Account switch route
    router.post('/accounts/:id/switch', async ({ params, auth, response }) => {
      try {
        const user = auth.getUserOrFail()
        const accountId = parseInt(params.id, 10)
        
        if (!accountId || isNaN(accountId)) {
          return response.badRequest({
            error: 'Invalid account ID',
            message: 'Account ID must be a valid number'
          })
        }
        
        const { default: ConnectedAccount } = await import('#models/connected_account')
        
        const connectedAccount = await ConnectedAccount.query()
          .where('id', accountId)
          .where('user_id', user.id)
          .where('platform', 'google_ads')
          .firstOrFail()
        
        return response.json({
          success: true,
          account: {
            id: connectedAccount.id,
            accountId: connectedAccount.accountId,
            formattedAccountId: connectedAccount.accountId.length === 10 ? 
              `${connectedAccount.accountId.slice(0, 3)}-${connectedAccount.accountId.slice(3, 6)}-${connectedAccount.accountId.slice(6)}` : 
              connectedAccount.accountId,
            displayName: connectedAccount.accountName || `Account ${connectedAccount.accountId}`,
            accountName: connectedAccount.accountName,
            isTestAccount: connectedAccount.isTestAccount || false,
            isManagerAccount: connectedAccount.isManagerAccount || false
          },
          message: `Switched to ${connectedAccount.accountName || connectedAccount.accountId}`
        })
      } catch (error) {
        console.error('🔴 Error switching account:', error);
        return response.badRequest({
          error: 'Failed to switch account',
          message: error.message
        })
      }
    }).as('integrations.switch_account')
    
    router.get('/accessible-customers', [IntegrationsController, 'getAccessibleCustomers']).as('integrations.accessible_customers')
    
    router.get('/connect/:platform', [IntegrationsController, 'connect']).as('integrations.connect')
    
    router.post('/connect', [IntegrationsController, 'connect']).as('integrations.connect.api')
    router.post('/connect/:platform', [IntegrationsController, 'connect']).as('integrations.connect.post')

    router.get('/callback/:platform', [IntegrationsController, 'callback']).as('integrations.callback')

    router.post('/disconnect/:id', [IntegrationsController, 'disconnect']).as('integrations.disconnect')

    router.post('/sync/:id', [IntegrationsController, 'sync']).as('integrations.sync')
    
    router.patch('/:id/name', [IntegrationsController, 'updateAccountName']).as('integrations.update_name')
    
    router.get('/:id', [IntegrationsController, 'show']).as('integrations.show')
    
  })
  .prefix('/integrations')
  .middleware([middleware.auth()])
