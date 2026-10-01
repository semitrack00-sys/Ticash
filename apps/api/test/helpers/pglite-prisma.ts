import { PGlite } from '@electric-sql/pglite';
import { DriverAdapterError, type SqlDriverAdapterFactory, type SqlQueryable, type ColumnType } from '@prisma/driver-adapter-utils';

// Test-only Prisma bridge to embedded PostgreSQL. No network or production URL.
// Serialize whole transactions (PGlite has one connection), not individual statements.
export function pglitePrisma(db: PGlite): SqlDriverAdapterFactory {
  let tail = Promise.resolve();
  async function acquire() {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    return release;
  }
  const types: Record<number, ColumnType> = { 16: 5, 20: 1, 21: 0, 23: 0, 25: 7, 1043: 7, 700: 2, 701: 3, 1700: 4, 114: 11, 3802: 11, 1082: 8, 1114: 10, 1184: 10, 2950: 15 };
  const queryable = (inside: boolean): SqlQueryable => ({
    provider: 'postgres', adapterName: 'test-pglite',
    async queryRaw(query) {
      const release = inside ? () => {} : await acquire();
      try {
        const result = await db.query<Record<string, unknown>>(query.sql, query.args);
        return { columnNames: result.fields.map(f => f.name), columnTypes: result.fields.map(f => types[f.dataTypeID] ?? 12),
          rows: result.rows.map(row => result.fields.map(f => {
            const value = row[f.name];
            if (value === null || value === undefined) return null;
            if (value instanceof Date) return value.toISOString();
            if ([114, 3802].includes(f.dataTypeID)) return JSON.stringify(value);
            if ([20, 1700].includes(f.dataTypeID)) return String(value);
            return value;
          })) };
      } catch (error) {
        const e = error as { code: string; message: string; detail?: string };
        throw new DriverAdapterError({ kind: 'postgres', code: e.code, message: e.message, severity: 'ERROR', detail: e.detail, column: undefined, hint: undefined });
      } finally { release(); }
    },
    async executeRaw(query) {
      const release = inside ? () => {} : await acquire();
      try { return (await db.query(query.sql, query.args)).affectedRows ?? 0; }
      finally { release(); }
    },
  });
  return {
    provider: 'postgres', adapterName: 'test-pglite',
    async connect() {
      return { ...queryable(false), executeScript: async sql => { await db.exec(sql); }, dispose: async () => {},
        getConnectionInfo: () => ({ schemaName: 'public', supportsRelationJoins: false }),
        async startTransaction() {
          const release = await acquire();
          await db.exec('BEGIN');
          return { ...queryable(true), options: { usePhantomQuery: true },
            commit: async () => { try { await db.exec('COMMIT'); } finally { release(); } },
            rollback: async () => { try { await db.exec('ROLLBACK'); } finally { release(); } },
          };
        },
      };
    },
  };
}
