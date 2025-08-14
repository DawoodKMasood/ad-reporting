import router from '@adonisjs/core/services/router'
const { middleware } = await import('#start/kernel')

const IntegrationsController = () => import('#controllers/integrations_controller')
const AccountManagementController = () => import('#controllers/account_management_controller')

// Protected integrations routes
router
  .group(() => {
    router.get('/', [IntegrationsController, 'index']).as('integrations.index')

    router.get('/:id', [IntegrationsController, 'show']).as('integrations.show')


    router.get('/connect/:platform', [IntegrationsController, 'connect']).as('integrations.connect')
    
    router.post('/connect', [IntegrationsController, 'connect']).as('integrations.connect.api')
    router.post('/connect/:platform', [IntegrationsController, 'connect']).as('integrations.connect.post')

    router.get('/callback/:platform', [IntegrationsController, 'callback']).as('integrations.callback')

    router.post('/disconnect/:id', [IntegrationsController, 'disconnect']).as('integrations.disconnect')

    router.post('/sync/:id', [IntegrationsController, 'sync']).as('integrations.sync')
    
    // Account management routes (for fixing mock accounts)
    router.post('/fix-mock-accounts', [AccountManagementController, 'fixMockAccounts']).as('integrations.fix_mock_accounts')
    router.post('/delete-mock-accounts', [AccountManagementController, 'deleteMockAccounts']).as('integrations.delete_mock_accounts')
    router.get('/list-accounts', [AccountManagementController, 'listAccounts']).as('integrations.list_accounts')
    router.post('/set-customer-id', [AccountManagementController, 'setCustomerId']).as('integrations.set_customer_id')
    router.post('/try-auto-fetch-customer-id', [AccountManagementController, 'tryAutoFetchCustomerId']).as('integrations.try_auto_fetch_customer_id')
  })
  .prefix('/integrations')
  .middleware([middleware.auth()])

