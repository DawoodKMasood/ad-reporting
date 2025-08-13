import router from '@adonisjs/core/services/router'
const { middleware } = await import('#start/kernel')

const IntegrationsController = () => import('#controllers/integrations_controller')

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
  })
  .prefix('/integrations')
  .middleware([middleware.auth()])

