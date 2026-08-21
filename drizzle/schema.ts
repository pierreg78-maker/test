import { bigint, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const archiveJobs = mysqlTable("archive_jobs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  sourceUrl: text("sourceUrl").notNull(),
  status: mysqlEnum("status", ["queued", "downloading", "archiving", "complete", "failed"]).notNull().default("queued"),
  totalCount: int("totalCount").notNull(),
  completedCount: int("completedCount").notNull().default(0),
  failedCount: int("failedCount").notNull().default(0),
  archiveUrl: text("archiveUrl"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const archiveJobImages = mysqlTable("archive_job_images", {
  id: int("id").autoincrement().primaryKey(),
  jobId: varchar("jobId", { length: 64 }).notNull(),
  imageId: varchar("imageId", { length: 32 }).notNull(),
  originalUrl: text("originalUrl").notNull(),
  previewUrl: text("previewUrl"),
  detailUrl: text("detailUrl").notNull(),
  status: mysqlEnum("status", ["queued", "downloading", "complete", "failed"]).notNull().default("queued"),
  fileName: varchar("fileName", { length: 255 }),
  byteSize: bigint("byteSize", { mode: "number" }),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
