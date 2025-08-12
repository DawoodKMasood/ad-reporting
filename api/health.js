export default function handler(req, res) {
  res.status(200).json({
    status: 'healthy',
    message: 'Health check endpoint working',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  })
}
