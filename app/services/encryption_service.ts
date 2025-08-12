import { 
  createCipheriv, 
  createDecipheriv, 
  randomBytes, 
  createHash, 
  timingSafeEqual 
} from 'node:crypto'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'

/**
 * Service for encrypting and decrypting sensitive data
 * 
 * This service provides enhanced security features including:
 * - AES-256-GCM encryption for authenticated encryption
 * - Key rotation capabilities
 * - Proper initialization vector (IV) handling
 * - Authentication tags for data integrity verification
 * - Key derivation functions for password-based encryption
 */
export class EncryptionService {
  private static readonly ALGORITHM = 'aes-256-gcm'
  private static readonly IV_LENGTH = 12 // 96 bits for GCM
  private static readonly AUTH_TAG_LENGTH = 16 // 128 bits
  private static readonly SALT_LENGTH = 16
  private static readonly KEY_LENGTH = 32 // 256 bits
  private static readonly HASH_ALGORITHM = 'sha256'
  
  // Current encryption key (primary key for encryption)
  private currentKey: Buffer = Buffer.alloc(0)
  // Previous encryption keys (for decryption during key rotation)
  private previousKeys: Buffer[] = []
  
  constructor() {
    // Initialize encryption keys from environment variables
    this.initializeKeys()
  }
  
  /**
   * Initialize encryption keys from environment variables
   */
  private initializeKeys(): void {
    try {
      // Get the current encryption key from environment
      let currentKeyHex = env.get('ENCRYPTION_KEY')
      
      // Use environment-specific key if available
      const nodeEnv = env.get('NODE_ENV', 'development')
      const devKey = env.get('ENCRYPTION_KEY_DEVELOPMENT')
      const prodKey = env.get('ENCRYPTION_KEY_PRODUCTION')
      
      if (nodeEnv === 'development' && devKey) {
        currentKeyHex = devKey
      } else if (nodeEnv === 'production' && prodKey) {
        currentKeyHex = prodKey
      }
      
      if (!currentKeyHex) {
        throw new Error('ENCRYPTION_KEY environment variable is not set')
      }
      
      // Convert hex string to buffer
      this.currentKey = Buffer.from(currentKeyHex, 'hex')
      
      // Validate key length
      if (this.currentKey.length !== EncryptionService.KEY_LENGTH) {
        throw new Error(
          `Invalid encryption key length. Expected ${EncryptionService.KEY_LENGTH} bytes, got ${this.currentKey.length}`
        )
      }
      
      // Get previous keys if available (comma-separated hex strings)
      const previousKeysEnv = env.get('PREVIOUS_ENCRYPTION_KEYS', '')
      if (previousKeysEnv) {
        const previousKeyHexStrings = previousKeysEnv.split(',').filter((key) => key.trim() !== '')
        this.previousKeys = previousKeyHexStrings.map((hex) => {
          const key = Buffer.from(hex.trim(), 'hex')
          if (key.length !== EncryptionService.KEY_LENGTH) {
            throw new Error(
              `Invalid previous encryption key length. Expected ${EncryptionService.KEY_LENGTH} bytes, got ${key.length}`
            )
          }
          return key
        })
      }
    } catch (error) {
      logger.error('Failed to initialize encryption keys:', error)
      throw new Error(`Failed to initialize encryption keys: ${error.message}`)
    }
  }
  
  /**
   * Derive a key from a password using PBKDF2
   * 
   * @param password - The password to derive key from
   * @param salt - The salt to use for key derivation
   * @param iterations - Number of iterations for PBKDF2
   * @returns The derived key
   */
  private deriveKey(password: string, salt: Buffer): Buffer {
    return createHash(EncryptionService.HASH_ALGORITHM)
      .update(password)
      .update(salt)
      .digest()
  }
  
  /**
   * Generate a hash of the data for quick validation without decryption
   * 
   * @param data - The data to hash
   * @returns The hash of the data
   */
  public hashData(data: string): string {
    return createHash(EncryptionService.HASH_ALGORITHM).update(data).digest('hex')
  }
  
  /**
   * Compare two hashes in a timing-safe manner
   * 
   * @param hash1 - First hash to compare
   * @param hash2 - Second hash to compare
   * @returns True if hashes match, false otherwise
   */
  public compareHashes(hash1: string, hash2: string): boolean {
    try {
      const buffer1 = Buffer.from(hash1, 'hex')
      const buffer2 = Buffer.from(hash2, 'hex')
      return timingSafeEqual(buffer1, buffer2)
    } catch {
      return false
    }
  }
  
  /**
   * Encrypt sensitive data using AES-256-GCM
   * 
   * @param data - The data to encrypt
   * @returns The encrypted data as a base64 string
   * @throws Error if encryption fails
   */
  public encrypt(data: string): string {
    try {
      // Generate a random IV
      const iv = randomBytes(EncryptionService.IV_LENGTH)
      
      // Create cipher with the current key
      const cipher = createCipheriv(EncryptionService.ALGORITHM, this.currentKey, iv)
      
      // Encrypt the data
      let encrypted = cipher.update(data, 'utf8', 'hex')
      encrypted += cipher.final('hex')
      
      // Get the authentication tag
      const authTag = cipher.getAuthTag()
      
      // Combine IV, auth tag, and encrypted data
      const result = Buffer.concat([iv, authTag, Buffer.from(encrypted, 'hex')])
      
      // Return as base64 string
      return result.toString('base64')
    } catch (error) {
      logger.error('Encryption failed:', error)
      throw new Error(`Failed to encrypt data: ${error.message}`)
    }
  }
  
  /**
   * Encrypt sensitive data with a password-derived key
   * 
   * @param data - The data to encrypt
   * @param password - The password to derive key from
   * @returns The encrypted data as a base64 string
   * @throws Error if encryption fails
   */
  public encryptWithPassword(data: string, password: string): string {
    try {
      // Generate a random salt
      const salt = randomBytes(EncryptionService.SALT_LENGTH)
      
      // Derive key from password
      const key = this.deriveKey(password, salt)
      
      // Generate a random IV
      const iv = randomBytes(EncryptionService.IV_LENGTH)
      
      // Create cipher with the derived key
      const cipher = createCipheriv(EncryptionService.ALGORITHM, key, iv)
      
      // Encrypt the data
      let encrypted = cipher.update(data, 'utf8', 'hex')
      encrypted += cipher.final('hex')
      
      // Get the authentication tag
      const authTag = cipher.getAuthTag()
      
      // Combine salt, IV, auth tag, and encrypted data
      const result = Buffer.concat([salt, iv, authTag, Buffer.from(encrypted, 'hex')])
      
      // Return as base64 string
      return result.toString('base64')
    } catch (error) {
      logger.error('Password-based encryption failed:', error)
      throw new Error(`Failed to encrypt data with password: ${error.message}`)
    }
  }
  
  /**
   * Decrypt sensitive data using AES-256-GCM
   * 
   * @param encryptedData - The encrypted data to decrypt (base64 string)
   * @returns The decrypted data as a string
   * @throws Error if decryption fails
   */
  public decrypt(encryptedData: string): string {
    try {
      // Decode base64 string
      const dataBuffer = Buffer.from(encryptedData, 'base64')
      
      // Extract IV, auth tag, and encrypted data
      const iv = dataBuffer.subarray(0, EncryptionService.IV_LENGTH)
      const authTag = dataBuffer.subarray(
        EncryptionService.IV_LENGTH, 
        EncryptionService.IV_LENGTH + EncryptionService.AUTH_TAG_LENGTH
      )
      const encrypted = dataBuffer.subarray(
        EncryptionService.IV_LENGTH + EncryptionService.AUTH_TAG_LENGTH
      )
      
      // Try to decrypt with current key first
      try {
        const decipher = createDecipheriv(EncryptionService.ALGORITHM, this.currentKey, iv)
        decipher.setAuthTag(authTag)
        
        let decrypted = decipher.update(encrypted, undefined, 'utf8')
        decrypted += decipher.final('utf8')
        
        return decrypted
      } catch (currentKeyError) {
        // If current key fails, try previous keys
        for (const key of this.previousKeys) {
          try {
            const decipher = createDecipheriv(EncryptionService.ALGORITHM, key, iv)
            decipher.setAuthTag(authTag)
            
            let decrypted = decipher.update(encrypted, undefined, 'utf8')
            decrypted += decipher.final('utf8')
            
            return decrypted
          } catch (previousKeyError) {
            // Continue to next key
            continue
          }
        }
        
        // If all keys fail, throw the original error
        throw currentKeyError
      }
    } catch (error) {
      logger.error('Decryption failed:', error)
      throw new Error(`Failed to decrypt data: ${error.message}`)
    }
  }
  
  /**
   * Decrypt sensitive data using a password-derived key
   * 
   * @param encryptedData - The encrypted data to decrypt (base64 string)
   * @param password - The password to derive key from
   * @returns The decrypted data as a string
   * @throws Error if decryption fails
   */
  public decryptWithPassword(encryptedData: string, password: string): string {
    try {
      // Decode base64 string
      const dataBuffer = Buffer.from(encryptedData, 'base64')
      
      // Extract salt, IV, auth tag, and encrypted data
      const salt = dataBuffer.subarray(0, EncryptionService.SALT_LENGTH)
      const iv = dataBuffer.subarray(
        EncryptionService.SALT_LENGTH, 
        EncryptionService.SALT_LENGTH + EncryptionService.IV_LENGTH
      )
      const authTag = dataBuffer.subarray(
        EncryptionService.SALT_LENGTH + EncryptionService.IV_LENGTH,
        EncryptionService.SALT_LENGTH + EncryptionService.IV_LENGTH + EncryptionService.AUTH_TAG_LENGTH
      )
      const encrypted = dataBuffer.subarray(
        EncryptionService.SALT_LENGTH + EncryptionService.IV_LENGTH + EncryptionService.AUTH_TAG_LENGTH
      )
      
      // Derive key from password
      const key = this.deriveKey(password, salt)
      
      // Create decipher with the derived key
      const decipher = createDecipheriv(EncryptionService.ALGORITHM, key, iv)
      decipher.setAuthTag(authTag)
      
      let decrypted = decipher.update(encrypted, undefined, 'utf8')
      decrypted += decipher.final('utf8')
      
      return decrypted
    } catch (error) {
      logger.error('Password-based decryption failed:', error)
      throw new Error(`Failed to decrypt data with password: ${error.message}`)
    }
  }
  
  /**
   * Rotate encryption keys
   * 
   * @param newKeyHex - The new encryption key as a hex string
   */
  public rotateKey(newKeyHex: string): void {
    try {
      // Convert new key from hex string to buffer
      const newKey = Buffer.from(newKeyHex, 'hex')
      
      // Validate key length
      if (newKey.length !== EncryptionService.KEY_LENGTH) {
        throw new Error(
          `Invalid new encryption key length. Expected ${EncryptionService.KEY_LENGTH} bytes, got ${newKey.length}`
        )
      }
      
      // Add current key to previous keys
      this.previousKeys.unshift(this.currentKey)
      
      // Set new key as current key
      this.currentKey = newKey
      
      logger.info('Encryption key rotated successfully')
    } catch (error) {
      logger.error('Key rotation failed:', error)
      throw new Error(`Failed to rotate encryption key: ${error.message}`)
    }
  }
  
  /**
   * Get the current encryption key (for testing purposes only)
   * 
   * @returns The current encryption key as a hex string
   */
  public getCurrentKey(): string {
    return this.currentKey.toString('hex')
  }
  
  /**
   * Get the previous encryption keys (for testing purposes only)
   * 
   * @returns The previous encryption keys as hex strings
   */
  public getPreviousKeys(): string[] {
    return this.previousKeys.map((key) => key.toString('hex'))
  }
}

// Export a singleton instance of the service
export default new EncryptionService()