import edge from 'edge.js'
import env from '#start/env'

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
