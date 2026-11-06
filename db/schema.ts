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

export const notificationPreferences = sqliteTable("notification_preferences", {
  userId: text("user_id").primaryKey(),
  partnerChanges: integer("partner_changes").notNull().default(1),
  reminders: integer("reminders").notNull().default(1),
  includePartner: integer("include_partner").notNull().default(1),
  minutes: integer("minutes").notNull().default(30),
  allDayTime: text("all_day_time").notNull().default("09:00"),
  quietEnabled: integer("quiet_enabled").notNull().default(0),
  quietStart: text("quiet_start").notNull().default("22:00"),
  quietEnd: text("quiet_end").notNull().default("08:00"),
  preview: integer("preview").notNull().default(0),
  revision: integer("revision").notNull().default(1),
  enabledAt: text("enabled_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  householdId: text("household_id").notNull().references(() => households.id),
  recipientId: text("recipient_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  eventId: text("event_id"),
  occurrenceDate: text("occurrence_date"),
  reminderStartAt: text("reminder_start_at"),
  reminderAllDay: integer("reminder_all_day").notNull().default(0),
  sourceRevision: integer("source_revision"),
  dedupeKey: text("dedupe_key").notNull(),
  createdAt: text("created_at").notNull(),
  readAt: text("read_at"),
}, (table) => [
  uniqueIndex("notifications_recipient_dedupe").on(table.recipientId, table.dedupeKey),
  index("notifications_recipient_created").on(table.recipientId, table.createdAt),
  index("notifications_recipient_read").on(table.recipientId, table.readAt),
]);

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  expirationTime: integer("expiration_time"),
  lastTestDay: text("last_test_day"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("push_subscriptions_endpoint").on(table.endpoint), index("push_subscriptions_user").on(table.userId)]);

export const notificationDeliveries = sqliteTable("notification_deliveries", {
  id: text("id").primaryKey(),
  notificationId: text("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
  subscriptionId: text("subscription_id").notNull().references(() => pushSubscriptions.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: text("next_attempt_at").notNull(),
  leaseUntil: text("lease_until"),
  leaseToken: text("lease_token"),
  sentAt: text("sent_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("notification_deliveries_unique").on(table.notificationId, table.subscriptionId),
  index("notification_deliveries_queue").on(table.status, table.nextAttemptAt),
]);

export const notificationDispatchState = sqliteTable("notification_dispatch_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Feedback belongs to its verified reporter, independently of couple membership.
export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  category: text("category").notNull(),
  page: text("page").notNull(),
  reporterId: text("reporter_id").notNull(),
  reporterName: text("reporter_name").notNull(),
  reporterEmail: text("reporter_email").notNull(),
  status: text("status").notNull().default("new"),
  priority: text("priority").notNull().default("none"),
  internalNote: text("internal_note").notNull().default(""),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("feedback_reporter_created").on(table.reporterId, table.createdAt),
  index("feedback_created_id").on(table.createdAt, table.id),
  index("feedback_status_created").on(table.status, table.createdAt, table.id),
]);
