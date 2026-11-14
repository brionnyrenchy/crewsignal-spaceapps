import * as SQLite from 'expo-sqlite';
import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';
import type { SqlBindValue, SqlRunResult, SqliteDriver, SqliteSession } from './driver';

function toExpoParams(params: readonly SqlBindValue[] = []): SQLiteBindValue[] {
  return params.map((value) => (value === undefined ? null : value));
}

function wrapExpoDatabase(db: SQLiteDatabase): SqliteSession {
  return {
    async exec(sql: string): Promise<void> {
      await db.execAsync(sql);
    },

    async run(sql: string, params: readonly SqlBindValue[] = []): Promise<SqlRunResult> {
      const res = await db.runAsync(sql, toExpoParams(params));
      return {
        changes: res.changes,
        lastInsertRowId: res.lastInsertRowId,
      };
    },

    async getFirst<T extends Record<string, unknown>>(
      sql: string,
      params: readonly SqlBindValue[] = [],
    ): Promise<T | null> {
      const row = await db.getFirstAsync<T>(sql, toExpoParams(params));
      return row ?? null;
    },

    async getAll<T extends Record<string, unknown>>(
      sql: string,
      params: readonly SqlBindValue[] = [],
    ): Promise<T[]> {
      return db.getAllAsync<T>(sql, toExpoParams(params));
    },
  };
}

/**
 * Native iOS / Android SQLite driver backed by expo-sqlite's asynchronous API
 * and exclusive transaction support.
 */
export class ExpoSqliteDriver implements SqliteDriver {
  private readonly session: SqliteSession;

  private constructor(private readonly db: SQLiteDatabase) {
    this.session = wrapExpoDatabase(db);
  }

  static async open(databaseName = 'crewsignal_v1.db'): Promise<ExpoSqliteDriver> {
    const db = await SQLite.openDatabaseAsync(databaseName);
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    return new ExpoSqliteDriver(db);
  }

  exec(sql: string): Promise<void> {
    return this.session.exec(sql);
  }

  run(sql: string, params?: readonly SqlBindValue[]): Promise<SqlRunResult> {
    return this.session.run(sql, params);
  }

  getFirst<T extends Record<string, unknown>>(
    sql: string,
    params?: readonly SqlBindValue[],
  ): Promise<T | null> {
    return this.session.getFirst<T>(sql, params);
  }

  getAll<T extends Record<string, unknown>>(
    sql: string,
    params?: readonly SqlBindValue[],
  ): Promise<T[]> {
    return this.session.getAll<T>(sql, params);
  }

  async withTransaction<T>(fn: (tx: SqliteSession) => Promise<T>): Promise<T> {
    let result!: T;
    await this.db.withExclusiveTransactionAsync(async (txn) => {
      result = await fn(wrapExpoDatabase(txn));
    });
    return result;
  }

  async close(): Promise<void> {
    await this.db.closeAsync();
  }
}
