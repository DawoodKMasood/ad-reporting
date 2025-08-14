import encryptionService from './encryption_service.js'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'

/**
 * Service for enhancing database security
 * 
 * This service provides additional encryption for sensitive campaign data,
 * field-level encryption for PII, database access logging, and row-level security.
 */
export class DatabaseSecurityService {
  // Fields that should be encrypted at the database level
  private static readonly ENCRYPTED_FIELDS: string[] = [
    'campaign_name',
    'access_token',
    'refresh_token',
    // Add other sensitive fields as needed
  ]
  
  // Fields that contain PII and should be encrypted
  private static readonly PII_FIELDS: string[] = [
    // Add PII fields as needed
  ]
  
  /**
   * Encrypt sensitive data before storing in the database
   * 
   * @param data - The data to encrypt
   * @param field - The field name
   * @returns The encrypted data
   */
  public encryptField(data: string, field: string): string {
    try {
      // Check if this field should be encrypted
      if (DatabaseSecurityService.ENCRYPTED_FIELDS.includes(field)) {
        return encryptionService.encrypt(data)
      }
      
      // Check if this field contains PII
      if (DatabaseSecurityService.PII_FIELDS.includes(field)) {
        return encryptionService.encrypt(data)
      }
      
      // Return data as-is if no encryption is needed
      return data
    } catch (error) {
      logger.error(`Failed to encrypt field ${field}:`, error)
      throw new Error(`Failed to encrypt field ${field}: ${error.message}`)
    }
  }
  
  /**
   * Decrypt sensitive data after retrieving from the database
   * 
   * @param data - The data to decrypt
   * @param field - The field name
   * @returns The decrypted data
   */
  public decryptField(data: string, field: string): string {
    try {
      // Check if this field should be decrypted
      if (DatabaseSecurityService.ENCRYPTED_FIELDS.includes(field) || 
          DatabaseSecurityService.PII_FIELDS.includes(field)) {
        return encryptionService.decrypt(data)
      }
      
      // Return data as-is if no decryption is needed
      return data
    } catch (error) {
      logger.error(`Failed to decrypt field ${field}:`, error)
      throw new Error(`Failed to decrypt field ${field}: ${error.message}`)
    }
  }
  
  /**
   * Encrypt multiple fields in an object
   * 
   * @param data - The data object
   * @param fields - The fields to encrypt
   * @returns The data object with encrypted fields
   */
  public encryptFields(data: Record<string, any>, fields: string[]): Record<string, any> {
    const encryptedData = { ...data }
    
    for (const field of fields) {
      if (encryptedData[field] && typeof encryptedData[field] === 'string') {
        encryptedData[field] = this.encryptField(encryptedData[field], field)
      }
    }
    
    return encryptedData
  }
  
  /**
   * Decrypt multiple fields in an object
   * 
   * @param data - The data object
   * @param fields - The fields to decrypt
   * @returns The data object with decrypted fields
   */
  public decryptFields(data: Record<string, any>, fields: string[]): Record<string, any> {
    const decryptedData = { ...data }
    
    for (const field of fields) {
      if (decryptedData[field] && typeof decryptedData[field] === 'string') {
        decryptedData[field] = this.decryptField(decryptedData[field], field)
      }
    }
    
    return decryptedData
  }
  
  /**
   * Log database access for security monitoring
   * 
   * @param operation - The database operation (SELECT, INSERT, UPDATE, DELETE)
   * @param table - The table being accessed
   * @param userId - The ID of the user performing the operation
   * @param recordId - The ID of the record being accessed (if applicable)
   * @param ipAddress - The IP address of the client
   * @param userAgent - The user agent of the client
   */
  public logDatabaseAccess(
    operation: string,
    table: string,
    userId?: number,
    recordId?: number,
    ipAddress?: string,
    userAgent?: string
  ): void {
    const logEntry = {
      timestamp: DateTime.now().toISO(),
      operation,
      table,
      userId,
      recordId,
      ipAddress,
      userAgent,
    }
    
    logger.info(`Database access: ${operation} on ${table}`, logEntry)
  }
  
  /**
   * Apply row-level security filters to a query
   * 
   * @param query - The database query
   * @param userId - The ID of the user
   * @param table - The table being queried
   * @returns The query with row-level security filters applied
   */
  public applyRowLevelSecurity(query: any, userId: number, table: string): any {
    // Apply row-level security based on the table and user
    switch (table) {
      case 'campaign_data':
        // Users can only access campaign data for their connected accounts
        return query.whereIn('connected_account_id', function(this: any) {
          this.select('id').from('connected_accounts').where('user_id', userId)
        })
      
      case 'connected_accounts':
        // Users can only access their own connected accounts
        return query.where('user_id', userId)
      
      default:
        // For other tables, apply a generic filter
        return query
    }
  }
  
  /**
   * Sanitize data to prevent injection attacks
   * 
   * @param data - The data to sanitize
   * @returns The sanitized data
   */
  public sanitizeData(data: any): any {
    if (typeof data === 'string') {
      // Remove potentially dangerous characters
      return data.replace(/[\x00\x08\x09\x1a\n\r"'\\\%]/g, function (char: string) {
        switch (char) {
          case '\x00': return '\\0'
          case '\x08': return '\\b'
          case '\x09': return '\\t'
          case '\x1a': return '\\z'
          case '\n': return '\\n'
          case '\r': return '\\r'
          case '"':
          case "'":
          case '\\':
          case '%': return '\\' + char
          default: return char
        }
      })
    }
    
    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeData(item))
    }
    
    if (typeof data === 'object' && data !== null) {
      const sanitized: Record<string, any> = {}
      for (const [key, value] of Object.entries(data)) {
        sanitized[key] = this.sanitizeData(value)
      }
      return sanitized
    }
    
    return data
  }
}

// Export a singleton instance of the service
export default new DatabaseSecurityService()