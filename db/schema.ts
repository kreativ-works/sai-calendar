import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const households = sqliteTable("households", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  aName: text("a_name").notNull(),
  bName: text("b_name").notNull(),
  anniversary: text("anniversary"),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
});

export const members = sqliteTable("members", {
  userId: text("user_id").primaryKey(),
  householdId: text("household_id").notNull().references(() => households.id),
  slot: text("slot").notNull(),
  email: text("email").notNull(),
  joinedAt: text("joined_at").notNull(),
}, (table) => [uniqueIndex("members_household_slot").on(table.householdId, table.slot)]);

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull().references(() => households.id),
  title: text("title").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  startTime: text("start_time"),
  endTime: text("end_time"),
  allDay: integer("all_day").notNull(),
  ownerScope: text("owner_scope").notNull(),
  category: text("category").notNull(),
  location: text("location").notNull().default(""),
  note: text("note").notNull().default(""),
  repeat: text("repeat_rule").notNull().default("none"),
  repeatUntil: text("repeat_until"),
  revision: integer("revision").notNull().default(1),
  createdBy: text("created_by").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("events_household_start").on(table.householdId, table.startDate)]);

export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull().references(() => households.id),
  codeHash: text("code_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
  usedAt: text("used_at"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("invitations_household").on(table.householdId)]);

// Firebase subject is scoped to a project. Canonical IDs remain stable when an
// existing member explicitly connects a new identity to their previous account.
export const authIdentities = sqliteTable("auth_identities", {
  provider: text("provider").notNull(),
  subject: text("subject").notNull(),
  userId: text("user_id").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("auth_identities_provider_subject").on(table.provider, table.subject),
  uniqueIndex("auth_identities_provider_user").on(table.provider, table.userId),
]);
