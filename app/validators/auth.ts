import vine from '@vinejs/vine'

/**
 * Validator to validate the payload when creating
 * a new user account.
 */
export const registerValidator = vine.compile(
  vine.object({
    fullName: vine.string().trim().minLength(2).maxLength(100).optional(),
    email: vine
      .string()
      .trim()
      .email()
      .unique(async (db, value) => {
        const user = await db.from('users').where('email', value).first()
        return !user
      }),
    password: vine.string().minLength(8).confirmed(),
  })
)

/**
 * Validator to validate the payload when logging
 * in a user.
 */
export const loginValidator = vine.compile(
  vine.object({
    email: vine.string().trim().email(),
    password: vine.string(),
  })
)

/**
 * Validator to validate the payload when requesting
 * a password reset.
 */
export const forgotPasswordValidator = vine.compile(
  vine.object({
    email: vine.string().trim().email(),
  })
)

/**
 * Validator to validate the payload when resetting
 * a password.
 */
export const resetPasswordValidator = vine.compile(
  vine.object({
    token: vine.string(),
    email: vine.string().trim().email(),
    password: vine.string().minLength(8).confirmed(),
  })
)