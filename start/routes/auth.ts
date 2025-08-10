import router from '@adonisjs/core/services/router'
const { middleware } = await import('#start/kernel')

const AuthController = () => import('#controllers/auth/auth_controller')

// Guest routes (accessible only when not authenticated)
router
  .group(() => {
    router.get('/login', [AuthController, 'showLogin']).as('auth.login')
    router.get('/register', [AuthController, 'showRegister']).as('auth.register')
    router.post('/login', [AuthController, 'login'])
    router.post('/register', [AuthController, 'register'])
  })
  .middleware([middleware.guest()])

// Authenticated routes
router
  .group(() => {
    router.post('/logout', [AuthController, 'logout']).as('auth.logout')
  })
  .middleware([middleware.auth()])
