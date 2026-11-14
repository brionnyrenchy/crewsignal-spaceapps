/**
 * Cross-runtime SQLite driver interface implemented by both the native
 * expo-sqlite adapter (iOS/Android) and the Node node:sqlite adapter (Jest tests).
 */
export type SqlBindValue = string | number | null | Uint8Array;

export interface SqlRunResult {
  changes: number;
  lastInsertRowId: number;
}

export interface SqliteSession {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlBindValue[]): Promise<SqlRunResult>;
  getFirst<T extends Record<string, unknown>>(
    sql: string,
    params?: readonly SqlBindValue[],
  ): Promise<T | null>;
  getAll<T extends Record<string, unknown>>(
    sql: string,
    params?: readonly SqlBindValue[],
  ): Promise<T[]>;
}

export interface SqliteDriver extends SqliteSession {
  /**
   * Executes callback inside an exclusive ACID transaction.
   * Any thrown error rolls back the entire transaction cleanly.
   */
  withTransaction<T>(fn: (tx: SqliteSession) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
