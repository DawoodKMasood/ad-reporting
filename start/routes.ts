/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'

// Import route modules
import './routes/auth.js'
import './routes/dashboard.js'

// Test route for debugging
router.get('/test', async ({ response }) => {
  response.header('Content-Type', 'text/html; charset=utf-8')
  return '<h1>Test Route Working</h1>'
})

// Home route - redirects based on auth status
router.get('/', async ({ auth, response }) => {
  if (await auth.check()) {
    return response.redirect().toRoute('dashboard.index')
  }
  return response.redirect().toRoute('auth.login')
})
