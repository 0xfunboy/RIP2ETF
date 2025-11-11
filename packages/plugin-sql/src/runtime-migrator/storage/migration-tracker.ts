import { sql } from 'drizzle-orm';
import {
  disableMigrationsMetadata,
  ensureMigrationsNamespace,
  isMigrationsMetadataDisabled,
  migrationTableSQL,
} from './migrations-namespace';
import type { DrizzleDB } from '../types';
import { randomUUID } from 'node:crypto';

export class MigrationTracker {
  constructor(private db: DrizzleDB) {}

  async ensureSchema(): Promise<void> {
    if (isMigrationsMetadataDisabled()) {
      return;
    }
    await ensureMigrationsNamespace(this.db);
  }

  async ensureTables(): Promise<void> {
    if (isMigrationsMetadataDisabled()) {
      return;
    }

    // Ensure schema exists
    await this.ensureSchema();

    try {
      // Create migrations table (like Drizzle's __drizzle_migrations)
      const migrationsTable = migrationTableSQL('_migrations');
      await this.db.execute(sql`
        CREATE TABLE IF NOT EXISTS ${migrationsTable} (
          id TEXT PRIMARY KEY,
          plugin_name TEXT NOT NULL,
          hash TEXT NOT NULL,
          created_at BIGINT NOT NULL
        )
      `);

      // Create journal table (replaces _journal.json)
      const journalTable = migrationTableSQL('_journal');
      await this.db.execute(sql`
        CREATE TABLE IF NOT EXISTS ${journalTable} (
          plugin_name TEXT PRIMARY KEY,
          version TEXT NOT NULL,
          dialect TEXT NOT NULL DEFAULT 'postgresql',
          entries JSONB NOT NULL DEFAULT '[]'
        )
      `);

      // Create snapshots table (replaces snapshot JSON files)
      const snapshotsTable = migrationTableSQL('_snapshots');
      await this.db.execute(sql`
        CREATE TABLE IF NOT EXISTS ${snapshotsTable} (
          plugin_name TEXT NOT NULL,
          idx INTEGER NOT NULL,
          snapshot JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          PRIMARY KEY(plugin_name, idx)
        )
      `);
    } catch (error) {
      disableMigrationsMetadata(error);
    }
  }

  async getLastMigration(pluginName: string): Promise<{
    id: number;
    hash: string;
    created_at: string;
  } | null> {
    if (isMigrationsMetadataDisabled()) {
      return null;
    }
    await this.ensureSchema();
    const table = migrationTableSQL('_migrations');
    const result = await this.db.execute(
      sql`SELECT id, hash, created_at 
          FROM ${table} 
          WHERE plugin_name = ${pluginName} 
          ORDER BY created_at DESC 
          LIMIT 1`
    );
    return (result.rows[0] as any) || null;
  }

  async recordMigration(pluginName: string, hash: string, createdAt: number): Promise<void> {
    if (isMigrationsMetadataDisabled()) {
      return;
    }
    await this.ensureSchema();
    const table = migrationTableSQL('_migrations');
    const id = randomUUID();
    await this.db.execute(
      sql`INSERT INTO ${table} (id, plugin_name, hash, created_at) 
          VALUES (${id}, ${pluginName}, ${hash}, ${createdAt})`
    );
  }
}
