import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { loginValidator, registerValidator } from '#validators/auth'

export default class AuthController {
  /**
   * Show login form
   */
  async showLogin({ view }: HttpContext) {
    return view.render('pages/auth/login')
  }

  /**
   * Show register form
   */
  async showRegister({ view }: HttpContext) {
    return view.render('pages/auth/register')
  }

  /**
   * Handle login request
   */
  async login({ auth, request, response, session }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)

    try {
      const user = await User.verifyCredentials(email, password)
      await auth.use('web').login(user)
      
      session.flash('success', 'Welcome back!')
      return response.redirect().toRoute('dashboard.index')
    } catch (error) {
      session.flash('error', 'Invalid credentials')
      return response.redirect().back()
    }
  }

  /**
   * Handle register request
   */
  async register({ auth, request, response, session }: HttpContext) {
    const data = await request.validateUsing(registerValidator)

    try {
      const user = await User.create(data)
      await auth.use('web').login(user)
      
      session.flash('success', 'Account created successfully!')
      return response.redirect().toRoute('dashboard.index')
    } catch (error) {
      session.flash('error', 'Registration failed. Please try again.')
      return response.redirect().back()
    }
  }

  /**
   * Handle logout request
   */
  async logout({ auth, response, session }: HttpContext) {
    await auth.use('web').logout()
    session.flash('success', 'Logged out successfully!')
    return response.redirect().toRoute('auth.login')
  }
}