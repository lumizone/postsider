import { PostgresStore } from '@mastra/pg';

export const pStore = new PostgresStore({
  id: 'postsider-store',
  connectionString: process.env.DATABASE_URL!,
});
