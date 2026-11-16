import { defineConfig } from 'drizzle-kit';

// DATABASE_URL se inyecta por dotenv-cli al ejecutar los scripts de npm
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
