import router from '@adonisjs/core/services/router'
const { middleware } = await import('#start/kernel')

const MultiAccountTestController = () => import('#controllers/multi_account_test_controller')

// Multi-account testing routes (only in development)
if (process.env.NODE_ENV === 'development') {
  router
    .group(() => {
      router.get('/', [MultiAccountTestController, 'index']).as('test.multi_account')
      router
        .get('/connection-test', [MultiAccountTestController, 'testConnection'])
        .as('test.connection')
      router
        .get('/debug/:id', [MultiAccountTestController, 'debugAccountInfo'])
        .as('test.debug_account')
      router
        .get('/format/:customerId', [MultiAccountTestController, 'formatCustomerId'])
        .as('test.format_customer_id')
    })
    .prefix('/test/multi-account')
    .middleware([middleware.auth()])
}
