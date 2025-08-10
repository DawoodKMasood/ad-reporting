import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class ContentTypeMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    // Set default content type for HTML responses
    ctx.response.header('Content-Type', 'text/html; charset=utf-8')
    
    const output = await next()
    return output
  }
}
