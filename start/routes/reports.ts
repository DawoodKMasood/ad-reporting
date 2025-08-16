import router from '@adonisjs/core/services/router'
const { middleware } = await import('#start/kernel')

const ReportsController = () => import('#controllers/reports/reports_controller')

// Protected reports routes
router
  .group(() => {
    router.get('/', [ReportsController, 'index']).as('reports.index')
    router.get('/custom', [ReportsController, 'custom']).as('reports.custom')
    router.post('/', [ReportsController, 'store']).as('reports.store')
    router.get('/:id', [ReportsController, 'show']).as('reports.show')
    router.put('/:id', [ReportsController, 'update']).as('reports.update')
    router.delete('/:id', [ReportsController, 'destroy']).as('reports.destroy')
    router.post('/:id/archive', [ReportsController, 'archive']).as('reports.archive')
    router.post('/save-layout', [ReportsController, 'saveLayout']).as('reports.saveLayout')
    router.get('/:id/load-layout', [ReportsController, 'loadLayout']).as('reports.loadLayout')
    router.post('/preview', [ReportsController, 'preview']).as('reports.preview')
  })
  .prefix('/reports')
  .middleware([middleware.auth()])
