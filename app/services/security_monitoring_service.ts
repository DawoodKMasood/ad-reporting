import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'

/**
 * Service for security monitoring and intrusion detection
 * 
 * This service provides security event logging, intrusion detection,
 * security alerts, and regular security audits.
 */
export class SecurityMonitoringService {
  private static readonly MAX_LOGIN_ATTEMPTS = 5
  private static readonly LOGIN_WINDOW_MS = 300000 // 5 minutes
  private static readonly SUSPICIOUS_ACTIVITY_THRESHOLD = 10
  
  // In-memory store for security events (in production, this should use a database)
  private securityEvents: Array<{
    id: string
    type: string
    userId?: number
    accountId?: number
    ipAddress?: string
    userAgent?: string
    timestamp: DateTime
    details?: any
  }> = []
  
  // In-memory store for login attempts (in production, this should use Redis or similar)
  private loginAttempts: Map<string, { count: number; timestamp: number }> = new Map()
  
  /**
   * Log a security event
   * 
   * @param type - The type of security event
   * @param details - Additional details about the event
   * @param userId - The ID of the user associated with the event (optional)
   * @param accountId - The ID of the account associated with the event (optional)
   * @param ipAddress - The IP address associated with the event (optional)
   * @param userAgent - The user agent associated with the event (optional)
   */
  public logSecurityEvent(
    type: string,
    details: any = {},
    userId?: number,
    accountId?: number,
    ipAddress?: string,
    userAgent?: string
  ): void {
    const event = {
      id: this.generateEventId(),
      type,
      userId,
      accountId,
      ipAddress,
      userAgent,
      timestamp: DateTime.now(),
      details
    }
    
    this.securityEvents.push(event)
    logger.info(`Security event: ${type}`, { event })
    
    // Check for suspicious activity
    this.checkForSuspiciousActivity(event)
  }
  
  /**
   * Check if a user should be rate limited for login attempts
   * 
   * @param identifier - The identifier to check (user ID, email, or IP address)
   * @returns True if the user should be rate limited, false otherwise
   */
  public shouldRateLimitLogin(identifier: string): boolean {
    const now = Date.now()
    const attempt = this.loginAttempts.get(identifier)
    
    if (!attempt) {
      this.loginAttempts.set(identifier, { count: 1, timestamp: now })
      return false
    }
    
    // Reset count if window has passed
    if (now - attempt.timestamp > SecurityMonitoringService.LOGIN_WINDOW_MS) {
      this.loginAttempts.set(identifier, { count: 1, timestamp: now })
      return false
    }
    
    // Increment count
    attempt.count++
    this.loginAttempts.set(identifier, attempt)
    
    // Apply rate limiting if threshold exceeded
    if (attempt.count >= SecurityMonitoringService.MAX_LOGIN_ATTEMPTS) {
      this.logSecurityEvent('login_rate_limit_exceeded', { 
        identifier,
        attempts: attempt.count
      })
      return true
    }
    
    return false
  }
  
  /**
   * Record a successful login
   * 
   * @param identifier - The identifier to reset (user ID, email, or IP address)
   */
  public recordSuccessfulLogin(identifier: string): void {
    // Reset login attempts for this identifier
    this.loginAttempts.delete(identifier)
    
    this.logSecurityEvent('successful_login', { identifier })
  }
  
  /**
   * Check for suspicious activity based on security events
   * 
   * @param event - The security event to check
   */
  private checkForSuspiciousActivity(event: any): void {
    // Count events of the same type in the last hour
    const oneHourAgo = DateTime.now().minus({ hours: 1 })
    const similarEvents = this.securityEvents.filter(e => 
      e.type === event.type && 
      e.timestamp >= oneHourAgo &&
      (e.userId === event.userId || e.ipAddress === event.ipAddress)
    )
    
    if (similarEvents.length >= SecurityMonitoringService.SUSPICIOUS_ACTIVITY_THRESHOLD) {
      this.sendSecurityAlert(
        'suspicious_activity_detected',
        `Suspicious activity detected: ${event.type}`,
        {
          eventType: event.type,
          eventCount: similarEvents.length,
          userId: event.userId,
          ipAddress: event.ipAddress,
          recentEvents: similarEvents.slice(-5) // Last 5 events
        }
      )
    }
  }
  
  /**
   * Send a security alert
   * 
   * @param type - The type of security alert
   * @param message - The alert message
   * @param details - Additional details about the alert
   */
  public sendSecurityAlert(type: string, message: string, details: any = {}): void {
    // In a real implementation, this would send alerts via email, SMS, or a monitoring service
    logger.warn(`Security Alert: ${type} - ${message}`, { details })
    
    // Log the alert as a security event
    this.logSecurityEvent('security_alert', { type, message, details })
  }
  
  /**
   * Perform a security audit
   * 
   * @returns Audit results
   */
  public async performSecurityAudit(): Promise<any> {
    const auditResults = {
      timestamp: DateTime.now(),
      totalEvents: this.securityEvents.length,
      recentEvents: this.securityEvents.slice(-10), // Last 10 events
      loginAttempts: Array.from(this.loginAttempts.entries()).map(([key, value]) => ({
        identifier: key,
        count: value.count,
        timestamp: value.timestamp
      })),
      suspiciousActivities: this.detectSuspiciousActivities()
    }
    
    logger.info('Security audit completed', auditResults)
    return auditResults
  }
  
  /**
   * Detect suspicious activities
   * 
   * @returns Array of suspicious activities
   */
  private detectSuspiciousActivities(): any[] {
    const suspiciousActivities: any[] = []
    
    // Check for multiple failed login attempts
    for (const [identifier, attempt] of this.loginAttempts.entries()) {
      if (attempt.count >= SecurityMonitoringService.MAX_LOGIN_ATTEMPTS) {
        suspiciousActivities.push({
          type: 'multiple_failed_logins',
          identifier,
          count: attempt.count,
          timestamp: attempt.timestamp
        })
      }
    }
    
    // Check for repeated security events
    const eventTypes = [...new Set(this.securityEvents.map(e => e.type))]
    for (const type of eventTypes) {
      const eventsOfType = this.securityEvents.filter(e => e.type === type)
      if (eventsOfType.length >= SecurityMonitoringService.SUSPICIOUS_ACTIVITY_THRESHOLD) {
        suspiciousActivities.push({
          type: 'repeated_security_events',
          eventType: type,
          count: eventsOfType.length,
          recentEvents: eventsOfType.slice(-5) // Last 5 events
        })
      }
    }
    
    return suspiciousActivities
  }
  
  /**
   * Generate a unique event ID
   * 
   * @returns A unique event ID
   */
  private generateEventId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
  }
  
  /**
   * Get security events for a specific user
   * 
   * @param userId - The ID of the user
   * @returns Array of security events for the user
   */
  public getUserSecurityEvents(userId: number): any[] {
    return this.securityEvents.filter(event => event.userId === userId)
  }
  
  /**
   * Get security events for a specific IP address
   * 
   * @param ipAddress - The IP address
   * @returns Array of security events for the IP address
   */
  public getIpSecurityEvents(ipAddress: string): any[] {
    return this.securityEvents.filter(event => event.ipAddress === ipAddress)
  }
  
  /**
   * Clear old security events to prevent memory issues
   */
  public clearOldEvents(): void {
    const oneDayAgo = DateTime.now().minus({ days: 1 })
    const oldEventCount = this.securityEvents.length
    
    this.securityEvents = this.securityEvents.filter(event => event.timestamp >= oneDayAgo)
    
    const clearedCount = oldEventCount - this.securityEvents.length
    if (clearedCount > 0) {
      logger.info(`Cleared ${clearedCount} old security events`)
    }
  }
}

// Export a singleton instance of the service
export default new SecurityMonitoringService()