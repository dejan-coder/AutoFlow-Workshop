export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://autoflow:autoflow@localhost:5432/autoflow',
  port: Number(process.env.PORT ?? 3000),
};
