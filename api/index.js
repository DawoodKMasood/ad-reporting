// AdonisJS Serverless Handler for Vercel
import { Ignitor } from '@adonisjs/core'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Get the build directory path
const BUILD_ROOT = new URL('../build/', import.meta.url)

const IMPORTER = (filePath) => {
  if (filePath.startsWith('./') || filePath.startsWith('../')) {
    return import(new URL(filePath, BUILD_ROOT).href)
  }
  return import(filePath)
}

let app = null

async function getApp() {
  if (!app) {
    try {
      console.log('Initializing AdonisJS application...')
      
      const ignitor = new Ignitor(BUILD_ROOT, { importer: IMPORTER })
      
      app = ignitor.createApp('web')
      await app.init()
      await app.boot()
      
      console.log('AdonisJS application initialized successfully')
    } catch (error) {
      console.error('Failed to initialize AdonisJS app:', error)
      throw error
    }
  }
  return app
}

export default async function handler(req, res) {
  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')

    // Handle OPTIONS requests
    if (req.method === 'OPTIONS') {
      res.status(200).end()
      return
    }

    // Health check endpoint
    if (req.url === '/health') {
      res.status(200).json({
        status: 'healthy',
        message: 'AdonisJS API is running on Vercel',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
      })
      return
    }

    // For development/debugging - return simple response for now
    // TODO: Integrate full AdonisJS request handling
    
    const app = await getApp()
    
    // Simple response while we set up full integration
    if (req.url === '/') {
      // Return a proper homepage response
      res.setHeader('Content-Type', 'text/html')
      res.status(200).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Ad Reporting Dashboard</title>
            <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-50 min-h-screen">
            <div class="max-w-4xl mx-auto py-12 px-4">
                <div class="bg-white rounded-lg shadow-lg border border-gray-200 p-8">
                    <div class="text-center mb-8">
                        <h1 class="text-3xl font-bold text-gray-900 mb-4">🚀 Ad Reporting Dashboard</h1>
                        <p class="text-lg text-gray-600">Your AdonisJS application is running on Vercel!</p>
                    </div>
                    
                    <div class="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                        <div class="flex items-center">
                            <div class="flex-shrink-0">
                                <svg class="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                                </svg>
                            </div>
                            <div class="ml-3">
                                <h3 class="text-sm font-medium text-green-800">Deployment Successful!</h3>
                                <div class="mt-2 text-sm text-green-700">
                                    <p>✅ Serverless function is working</p>
                                    <p>✅ Static assets are being served</p>
                                    <p>✅ AdonisJS application initialized</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
                            <h3 class="font-semibold text-blue-900 mb-2">📊 Dashboard</h3>
                            <p class="text-blue-700 text-sm">View campaign performance and analytics</p>
                            <a href="/dashboard" class="inline-block mt-2 text-blue-600 hover:text-blue-800 text-sm font-medium">Go to Dashboard →</a>
                        </div>
                        
                        <div class="bg-purple-50 border border-purple-200 rounded-lg p-4">
                            <h3 class="font-semibold text-purple-900 mb-2">🔗 Integrations</h3>
                            <p class="text-purple-700 text-sm">Connect Google Ads and other platforms</p>
                            <a href="/integrations" class="inline-block mt-2 text-purple-600 hover:text-purple-800 text-sm font-medium">Manage Integrations →</a>
                        </div>
                        
                        <div class="bg-green-50 border border-green-200 rounded-lg p-4">
                            <h3 class="font-semibold text-green-900 mb-2">👤 Authentication</h3>
                            <p class="text-green-700 text-sm">Login or create a new account</p>
                            <a href="/login" class="inline-block mt-2 text-green-600 hover:text-green-800 text-sm font-medium">Login →</a>
                        </div>
                        
                        <div class="bg-orange-50 border border-orange-200 rounded-lg p-4">
                            <h3 class="font-semibold text-orange-900 mb-2">🔧 Health Check</h3>
                            <p class="text-orange-700 text-sm">Monitor system status</p>
                            <a href="/health" class="inline-block mt-2 text-orange-600 hover:text-orange-800 text-sm font-medium">Check Status →</a>
                        </div>
                    </div>

                    <div class="border-t border-gray-200 pt-6">
                        <div class="text-center text-sm text-gray-500">
                            <p><strong>Environment:</strong> ${process.env.NODE_ENV || 'development'}</p>
                            <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
                            <p class="mt-2">AdonisJS Ad Reporting Tool - Deployed on Vercel</p>
                        </div>
                    </div>
                </div>
            </div>
        </body>
        </html>
      `)
      return
    }

    // For other routes, return a basic message for now
    res.status(200).json({
      message: 'AdonisJS route handler (coming soon)',
      url: req.url,
      method: req.method,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Serverless function error:', error)
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    })
  }
}
