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
import './routes/integrations.js'

// Test route to verify Edge is working
router.get('/edge-test', async ({ view }) => {
  return view.render('test')
})

// Home route - redirects based on auth status
router.get('/', async ({ auth, response }) => {
  if (await auth.check()) {
    return response.redirect().toRoute('dashboard.index')
  }
  return response.redirect().toRoute('auth.login')
})
