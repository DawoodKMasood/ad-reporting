import type { HttpContext } from '@adonisjs/core/http'

export default class DashboardController {
  /**
   * Display dashboard index page
   */
  async index({ view, auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    response.header('Content-Type', 'text/html; charset=utf-8')
    
    return view.render('pages/dashboard/index', {
      user,
      stats: {
        totalSpend: 0,
        totalImpressions: 0,
        totalClicks: 0,
        totalConversions: 0,
      },
      connectedAccounts: [],
    })
  }

  /**
   * Display dashboard overview
   */
  async overview({ view, auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    response.header('Content-Type', 'text/html; charset=utf-8')
    
    return view.render('pages/dashboard/overview', {
      user,
    })
  }
}
