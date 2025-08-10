import vine from '@vinejs/vine'

/**
 * Validator to validate the payload when connecting to a platform
 */
export const connectValidator = vine.compile(
  vine.object({
    platform: vine.string().trim().in(['google_ads', 'meta_ads', 'tiktok_ads']),
  })
)

/**
 * Validator to validate the payload when disconnecting an account
 */
export const disconnectValidator = vine.compile(
  vine.object({
    id: vine.number().positive(),
  })
)

/**
 * Validator to validate the payload when syncing data
 */
export const syncValidator = vine.compile(
  vine.object({
    id: vine.number().positive(),
  })
)
