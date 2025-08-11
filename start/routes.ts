/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
import logger from '@adonisjs/core/services/logger'

// Import route modules
import './routes/auth.js'
import './routes/dashboard.js'
import './routes/integrations.js'

// Test route to verify Edge is working
router.get('/edge-test', async ({ view }) => {
  logger.info('Rendering edge-test view')
  console.log('Rendering edge-test view')
  try {
    const renderedView = await view.render('test')
    console.log('Rendered edge-test view content length:', renderedView.length)
    // Log first and last parts to check if it's raw template code
    console.log('First 200 chars:', renderedView.substring(0, 200))
    console.log('Last 200 chars:', renderedView.substring(Math.max(0, renderedView.length - 200)))
    return renderedView
  } catch (error) {
    console.error('Error rendering edge-test view:', error)
    throw error
  }
})

// Home route - redirects based on auth status
router.get('/', async ({ auth, response }) => {
  if (await auth.check()) {
    return response.redirect().toRoute('dashboard.index')
  }
  return response.redirect().toRoute('auth.login')
})
