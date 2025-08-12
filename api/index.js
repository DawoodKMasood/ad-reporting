// Simple serverless API for ad reporting
export default async function handler(req, res) {
  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Content-Type', 'application/json')

    // Handle OPTIONS requests
    if (req.method === 'OPTIONS') {
      res.status(200).end()
      return
    }

    const { url, method } = req
    const path = new URL(url, `http://${req.headers.host}`).pathname

    // Route handling
    switch (path) {
      case '/':
        return handleHome(req, res)
      case '/health':
        return handleHealth(req, res)
      default:
        return handleNotFound(req, res)
    }

  } catch (error) {
    console.error('API Error:', error)
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message
    })
  }
}

function handleHome(req, res) {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Ad Reporting Dashboard</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #333; text-align: center; }
            .status { background: #e8f5e8; padding: 20px; border-radius: 4px; margin: 20px 0; }
            .feature { background: #f8f9fa; padding: 15px; margin: 10px 0; border-left: 4px solid #007bff; }
            .btn { background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block; margin: 5px; }
            .btn:hover { background: #0056b3; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Ad Reporting Dashboard</h1>
            
            <div class="status">
                <h3>✅ Deployment Successful!</h3>
                <p>Your ad reporting application is now running on Vercel.</p>
                <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
                <p><strong>Environment:</strong> ${process.env.NODE_ENV || 'development'}</p>
            </div>

            <h3>Available Features:</h3>
            <div class="feature">
                <h4>📊 Dashboard</h4>
                <p>View campaign performance metrics and analytics</p>
            </div>
            
            <div class="feature">
                <h4>🔗 Google Ads Integration</h4>
                <p>Connect and sync data from Google Ads campaigns</p>
            </div>
            
            <div class="feature">
                <h4>📈 Performance Tracking</h4>
                <p>Monitor spend, impressions, clicks, and conversions</p>
            </div>

            <div style="text-align: center; margin-top: 30px;">
                <a href="/health" class="btn">Health Check</a>
                <a href="#" class="btn">Login (Coming Soon)</a>
                <a href="#" class="btn">Dashboard (Coming Soon)</a>
            </div>

            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; color: #666; text-align: center;">
                <p>AdonisJS Ad Reporting Tool - Deployed on Vercel</p>
            </div>
        </div>
    </body>
    </html>
  `
  
  res.setHeader('Content-Type', 'text/html')
  res.status(200).send(html)
}

function handleHealth(req, res) {
  res.status(200).json({
    status: 'healthy',
    message: 'Ad Reporting API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  })
}

function handleNotFound(req, res) {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.url} not found`,
    availableRoutes: ['/', '/health']
  })
}
