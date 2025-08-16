import router from '@adonisjs/core/services/router'
const { middleware } = await import('#start/kernel')

const ReportsController = () => import('#controllers/reports/reports_controller')

// Protected reports routes
router
  .group(() => {
    router.get('/', [ReportsController, 'index']).as('reports.index')
    router.get('/performance', [ReportsController, 'performance']).as('reports.performance')
    router.get('/custom', [ReportsController, 'custom']).as('reports.custom')
  })
  .prefix('/reports')
  .middleware([middleware.auth()])
