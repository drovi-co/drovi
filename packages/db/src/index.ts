// =============================================================================
// DATABASE CLIENT
// =============================================================================
//
// PostgreSQL database client with connection pooling for production workloads.
// Uses drizzle-orm for type-safe queries.
//

import { env } from "@memorystack/env/server";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

// =============================================================================
// CONNECTION POOL
// =============================================================================

/**
 * PostgreSQL connection pool with production-ready settings
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // Connection pool settings
  max: 20, // Maximum connections per instance
  idleTimeoutMillis: 30000, // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Timeout for new connection attempts
  // Statement timeout for long-running queries
  statement_timeout: 30000, // 30 seconds
});

// Log pool errors
pool.on("error", (err) => {
  console.error("[Database] Pool error:", err.message);
});

// =============================================================================
// DRIZZLE CLIENT
// =============================================================================

export const db = drizzle(pool, { schema });

// =============================================================================
// HEALTH CHECK
// =============================================================================

export interface DatabaseHealthCheck {
  connected: boolean;
  latencyMs: number | null;
  poolSize: number;
  idleConnections: number;
  waitingClients: number;
  error?: string;
}

/**
 * Check database connection health with latency measurement
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealthCheck> {
  try {
    const start = performance.now();
    const client = await pool.connect();

    try {
      await client.query("SELECT 1");
      const latencyMs = Math.round(performance.now() - start);

      return {
        connected: true,
        latencyMs,
        poolSize: pool.totalCount,
        idleConnections: pool.idleCount,
        waitingClients: pool.waitingCount,
      };
    } finally {
      client.release();
    }
  } catch (error) {
    return {
      connected: false,
      latencyMs: null,
      poolSize: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingClients: pool.waitingCount,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check if database is connected (simple boolean check)
 */
export async function isDatabaseConnected(): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      return true;
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}

// =============================================================================
// GRACEFUL SHUTDOWN
// =============================================================================

/**
 * Gracefully close all database connections
 * Should be called during application shutdown
 */
export async function disconnectDatabase(): Promise<void> {
  console.log("[Database] Closing connection pool...");
  await pool.end();
  console.log("[Database] Connection pool closed");
}

// =============================================================================
// RE-EXPORTS
// =============================================================================

export { schema };
