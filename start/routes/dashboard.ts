import router from '@adonisjs/core/services/router'
const { middleware } = await import('#start/kernel')

const DashboardController = () => import('#controllers/dashboard/dashboard_controller')

// Protected dashboard routes
router.group(() => {
  router.get('/', [DashboardController, 'index']).as('dashboard.index')
  router.get('/overview', [DashboardController, 'overview']).as('dashboard.overview')
})
.prefix('/dashboard')
.middleware([middleware.auth()])
