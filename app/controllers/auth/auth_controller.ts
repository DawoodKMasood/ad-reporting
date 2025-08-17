import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { loginValidator, registerValidator } from '#validators/auth'
import securityMonitoringService from '#services/security_monitoring_service'

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
    try {
      const { email, password } = await request.validateUsing(loginValidator)

      // Get client IP address for security monitoring
      const ipAddress = request.ip()

      // Check if rate limiting should be applied
      if (
        securityMonitoringService.shouldRateLimitLogin(email) ||
        securityMonitoringService.shouldRateLimitLogin(ipAddress)
      ) {
        session.flash('error', 'Too many login attempts. Please try again later.')
        session.flashAll()
        return response.redirect().back()
      }

      const user = await User.verifyCredentials(email, password)
      await auth.use('web').login(user)

      // Record successful login
      securityMonitoringService.recordSuccessfulLogin(email)
      securityMonitoringService.recordSuccessfulLogin(ipAddress)

      // Log security event
      securityMonitoringService.logSecurityEvent(
        'user_login',
        { email: user.email },
        user.id,
        undefined,
        ipAddress,
        request.header('user-agent')
      )

      session.flash('success', 'Welcome back!')
      return response.redirect().toRoute('dashboard.index')
    } catch (error) {
      // Log failed login attempt
      const ipAddress = request.ip()
      securityMonitoringService.logSecurityEvent(
        'failed_login',
        {
          email: request.input('email'),
          error: error.message,
        },
        undefined,
        undefined,
        ipAddress,
        request.header('user-agent')
      )

      session.flash('error', 'Invalid credentials')
      session.flashAll()
      return response.redirect().back()
    }
  }

  /**
   * Handle register request
   */
  async register({ auth, request, response, session }: HttpContext) {
    try {
      const data = await request.validateUsing(registerValidator)

      // Get client IP address for security monitoring
      const ipAddress = request.ip()

      const user = await User.create(data)
      await auth.use('web').login(user)

      // Log security event
      securityMonitoringService.logSecurityEvent(
        'user_registration',
        { email: user.email },
        user.id,
        undefined,
        ipAddress,
        request.header('user-agent')
      )

      session.flash('success', 'Account created successfully!')
      return response.redirect().toRoute('dashboard.index')
    } catch (error) {
      // Log failed registration attempt
      const ipAddress = request.ip()
      securityMonitoringService.logSecurityEvent(
        'failed_registration',
        {
          email: request.input('email'),
          error: error.message,
        },
        undefined,
        undefined,
        ipAddress,
        request.header('user-agent')
      )

      session.flash('error', 'Registration failed. Please try again.')
      session.flashAll()
      return response.redirect().back()
    }
  }

  /**
   * Handle logout request
   */
  async logout({ auth, request, response, session }: HttpContext) {
    try {
      const user = auth.getUserOrFail()

      // Get client IP address for security monitoring
      const ipAddress = request.ip()

      await auth.use('web').logout()

      // Log security event
      securityMonitoringService.logSecurityEvent(
        'user_logout',
        { email: user.email },
        user.id,
        undefined,
        ipAddress,
        request.header('user-agent')
      )

      session.flash('success', 'Logged out successfully!')
      return response.redirect().toRoute('auth.login')
    } catch (error) {
      session.flash('error', 'Logout failed. Please try again.')
      return response.redirect().back()
    }
  }
}
