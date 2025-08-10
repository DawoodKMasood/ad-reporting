import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { loginValidator, registerValidator } from '#validators/auth'

export default class AuthController {
  /**
   * Show login form
   */
  async showLogin({ view, response }: HttpContext) {
    response.header('Content-Type', 'text/html; charset=utf-8')
    
    // Test with direct HTML response first
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Login - Test</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gradient-to-r from-blue-600 to-purple-600 min-h-screen flex items-center justify-center">
      <div class="bg-white p-8 rounded-lg shadow-lg">
        <h1 class="text-2xl font-bold mb-4">Login Page</h1>
        <p>If you can see this styled page, the routing works!</p>
        <form method="POST" action="/login">
          <input type="email" name="email" placeholder="Email" class="border p-2 rounded mb-2 w-full" required>
          <input type="password" name="password" placeholder="Password" class="border p-2 rounded mb-4 w-full" required>
          <button type="submit" class="bg-blue-500 text-white px-4 py-2 rounded w-full">Login</button>
        </form>
      </div>
    </body>
    </html>
    `
    
    // Uncomment this line and comment the above when direct HTML works
    // return view.render('pages/auth/login')
  }

  /**
   * Show register form
   */
  async showRegister({ view, response }: HttpContext) {
    response.header('Content-Type', 'text/html; charset=utf-8')
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
