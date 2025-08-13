/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  HOST: Env.schema.string({ format: 'host' }),
  APP_URL: Env.schema.string.optional(),
  LOG_LEVEL: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | Variables for configuring session package
  |----------------------------------------------------------
  */
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory'] as const),

  /*
  |----------------------------------------------------------
  | Variables for configuring database connection
  |----------------------------------------------------------
  */
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string(),
  DB_SSL: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for Google Ads OAuth2
  |----------------------------------------------------------
  */
  GOOGLE_ADS_CLIENT_ID: Env.schema.string(),
  GOOGLE_ADS_CLIENT_SECRET: Env.schema.string(),
  GOOGLE_ADS_DEVELOPER_TOKEN: Env.schema.string(),
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | Variables for encryption
  |----------------------------------------------------------
  */
  ENCRYPTION_KEY: Env.schema.string(),
  PREVIOUS_ENCRYPTION_KEYS: Env.schema.string.optional(),
  ENCRYPTION_KEY_DEVELOPMENT: Env.schema.string.optional(),
  ENCRYPTION_KEY_PRODUCTION: Env.schema.string.optional(),
})