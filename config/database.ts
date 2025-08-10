import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  connection: 'postgres',
  connections: {
    postgres: {
      client: 'pg',
      connection: `postgresql://${env.get('DB_USER')}:${env.get('DB_PASSWORD')}@${env.get('DB_HOST')}:${env.get('DB_PORT')}/${env.get('DB_DATABASE')}?pgbouncer=true`,
      pool: {
        min: 0,
        max: 7,
        acquireTimeoutMillis: 300000,
        createTimeoutMillis: 30000,
        idleTimeoutMillis: 30000,
        reapIntervalMillis: 1000,
        createRetryIntervalMillis: 200,
      },
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
        tableName: 'adonis_schema',
        disableTransactions: false,
      },
    },
  },
})

export default dbConfig
