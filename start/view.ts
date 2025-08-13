import edge from 'edge.js'
import env from '#start/env'
import router from '@adonisjs/core/services/router'

/**
 * Define global properties
 */
edge.global('appUrl', env.get('APP_URL'))

/**
 * Global helper functions
 */
edge.global('formatNumber', (value: number): string => {
  if (typeof value !== 'number') return '0'
  return value.toLocaleString()
})

edge.global('now', () => {
  return new Date()
})

/**
 * Register global for flash messages - use session directly
 */
edge.global('flashMessages', function (this: any) {
  return this.ctx?.session?.flashMessages
})

/**
 * Register global for auth
 */
edge.global('auth', function (this: any) {
  return this.ctx?.auth
})

/**
 * Register global for CSRF field helper
 */
edge.global('csrfField', function (this: any) {
  const token = this.ctx?.request?.csrfToken
  return token ? `<input type="hidden" name="_token" value="${token}">` : ''
})

/**
 * Register global for CSRF token
 */
edge.global('csrfToken', function (this: any) {
  return this.ctx?.request?.csrfToken || ''
})

/**
 * Register route helper
 */
edge.global('route', (routeName: string, params?: any) => {
  try {
    return router.makeUrl(routeName, params)
  } catch {
    return '#'
  }
})

/**
 * Register old input helper
 */
edge.global('old', function (this: any, key: string, defaultValue: any = null) {
  const session = this.ctx?.session
  if (!session?.flashMessages) {
    return defaultValue
  }
  
  try {
    const oldData = session.flashMessages.get('old') || {}
    return oldData[key] !== undefined ? oldData[key] : defaultValue
  } catch {
    return defaultValue
  }
})
