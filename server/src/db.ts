import pg from 'pg';

// BIGINT -> number (id:n ryms gott i JS number för en verkstad)
pg.types.setTypeParser(20, (v) => Number(v));

export type Db = pg.Pool;

export function createDb(connectionString: string): Db {
  return new pg.Pool({ connectionString });
}
