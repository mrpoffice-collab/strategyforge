import path from 'node:path'
import { defineConfig } from 'prisma/config'
import 'dotenv/config'

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),

  datasource: {
    url: process.env.DATABASE_URL!,
  },

  migrate: {
    async adapter() {
      const { PrismaNeon } = await import('@prisma/adapter-neon')
      const { neonConfig, Pool } = await import('@neondatabase/serverless')

      neonConfig.wsProxy = (host) => `${host}:5433/v1`
      neonConfig.useSecureWebSocket = true
      neonConfig.pipelineTLS = false
      neonConfig.pipelineConnect = false

      const pool = new Pool({ connectionString: process.env.DATABASE_URL })
      return new PrismaNeon(pool)
    },
  },
})
