import pg from 'pg';

// BIGINT och NUMERIC -> number (belopp har två decimaler och ryms gott i JS number)
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
// DATE -> 'ÅÅÅÅ-MM-DD' som sträng, utan tidszonsomvandling
pg.types.setTypeParser(1082, (v) => v);

export type Db = pg.Pool;
/** Något som kan köra frågor: poolen eller en klient i en transaktion. */
export type Q = Pick<pg.PoolClient, 'query'>;

export function createDb(connectionString: string): Db {
  return new pg.Pool({ connectionString });
}

export async function withTx<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
