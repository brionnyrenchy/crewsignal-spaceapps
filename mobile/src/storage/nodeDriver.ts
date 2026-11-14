import type { SqlBindValue, SqlRunResult, SqliteDriver, SqliteSession } from './driver';

/**
 * Node built-in node:sqlite adapter for executing the exact CrewSignal SQLite
 * repository, schema, constraints, and ACID transactions in Jest unit/integration tests.
 */
export class NodeSqliteDriver implements SqliteDriver {
  private readonly db: {
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: SqlBindValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
      get(...params: SqlBindValue[]): Record<string, unknown> | undefined;
      all(...params: SqlBindValue[]): Record<string, unknown>[];
    };
    close(): void;
  };
  private inTransaction = false;

  constructor(filename = ':memory:') {
    // Loaded dynamically so Metro/Expo native bundles never attempt to resolve node:sqlite.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeSqlite = require('node:sqlite') as {
      DatabaseSync: new (path: string) => NodeSqliteDriver['db'];
    };
    this.db = new nodeSqlite.DatabaseSync(filename);
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async run(sql: string, params: readonly SqlBindValue[] = []): Promise<SqlRunResult> {
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);
    return {
      changes: Number(result.changes ?? 0),
      lastInsertRowId: Number(result.lastInsertRowid ?? 0),
    };
  }

  async getFirst<T extends Record<string, unknown>>(
    sql: string,
    params: readonly SqlBindValue[] = [],
  ): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params);
    return (row as T | undefined) ?? null;
  }

  async getAll<T extends Record<string, unknown>>(
    sql: string,
    params: readonly SqlBindValue[] = [],
  ): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  async withTransaction<T>(fn: (tx: SqliteSession) => Promise<T>): Promise<T> {
    if (this.inTransaction) {
      return fn(this);
    }
    this.inTransaction = true;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn(this);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Ignore rollback error if transaction already aborted by SQLite
      }
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
