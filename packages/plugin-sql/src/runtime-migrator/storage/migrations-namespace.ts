import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '../types';
import { logger } from '@elizaos/core';

const MIGRATIONS_SCHEMA = 'migrations';
const TABLE_PREFIX = 'migration_';

let namespaceMode: 'schema' | 'flat' = 'schema';
let initialized = false;
let metadataDisabled = false;

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

export async function ensureMigrationsNamespace(db: DrizzleDB): Promise<void> {
  if (metadataDisabled) return;
  if (initialized) {
    return;
  }

  try {
    await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS ${quote(MIGRATIONS_SCHEMA)}`));
    namespaceMode = 'schema';
  } catch (error) {
    namespaceMode = 'flat';
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      `[RuntimeMigrator] Schema '${MIGRATIONS_SCHEMA}' not supported in this database; storing migration metadata in public schema`
    );
  }

  initialized = true;
}

export function disableMigrationsMetadata(error?: unknown): void {
  if (metadataDisabled) {
    return;
  }

  metadataDisabled = true;
  logger.warn(
    {
      error: error instanceof Error ? error.message : String(error),
    },
    '[RuntimeMigrator] Disabling runtime migration tracking because the database dialect does not support required metadata tables'
  );
}

export function isMigrationsMetadataDisabled(): boolean {
  return metadataDisabled;
}

function getIdentifier(tableName: string): string {
  const normalized = tableName.startsWith('_') ? tableName : `_${tableName}`;
  if (namespaceMode === 'schema') {
    return `${quote(MIGRATIONS_SCHEMA)}.${quote(normalized)}`;
  }

  const flattened = `${TABLE_PREFIX}${normalized.replace(/^_/, '')}`;
  return quote(flattened);
}

export function migrationTableIdentifier(tableName: string): string {
  return getIdentifier(tableName);
}

export function migrationTableSQL(tableName: string) {
  return sql.raw(getIdentifier(tableName));
}
