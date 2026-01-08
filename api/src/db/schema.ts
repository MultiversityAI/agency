import {
  integer,
  sqliteTable,
  text,
  blob,
  index,
} from "drizzle-orm/sqlite-core";

// =============================================================================
// CONTEXT GRAPH: EVENT CLOCK SCHEMA
// Captures trajectories and events, not just state
// =============================================================================

// Conversations - container for chat sessions
export const conversation = sqliteTable("conversation", {
  id: text("id").primaryKey(),
  nearAccountId: text("near_account_id").notNull(),
  title: text("title"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Messages - individual chat messages
export const message = sqliteTable("message", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversation.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content").notNull(),
  trajectoryId: text("trajectory_id").references(() => trajectory.id),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// Trajectories - complete agent walks through problem space
// Each trajectory = one informed walk through the context graph
export const trajectory = sqliteTable(
  "trajectory",
  {
    id: text("id").primaryKey(),
    nearAccountId: text("near_account_id").notNull(),
    conversationId: text("conversation_id").references(() => conversation.id),
    inputText: text("input_text").notNull(),
    inputHash: text("input_hash").notNull(), // For finding similar starting points
    summary: text("summary"), // Auto-generated after completion
    embedding: blob("embedding"), // Structural embedding of this walk
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => [
    index("trajectory_account_idx").on(table.nearAccountId),
    index("trajectory_conversation_idx").on(table.conversationId),
    index("trajectory_input_hash_idx").on(table.inputHash),
  ]
);

// Events - individual touches during a trajectory
// The event clock: what happened, in what order
export const event = sqliteTable(
  "event",
  {
    id: text("id").primaryKey(),
    trajectoryId: text("trajectory_id")
      .notNull()
      .references(() => trajectory.id, { onDelete: "cascade" }),
    sequenceNum: integer("sequence_num").notNull(), // Order within trajectory
    timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
    eventType: text("event_type", {
      enum: ["touch", "reason", "decide", "discover"],
    }).notNull(),
    entityId: text("entity_id").references(() => entity.id), // Nullable for reasoning events
    data: text("data"), // JSON: event-specific payload
  },
  (table) => [
    index("event_trajectory_idx").on(table.trajectoryId),
    index("event_entity_idx").on(table.entityId),
  ]
);

// Entities - shared PCK context graph (global across all contributors)
// Topics, misconceptions, strategies, constraints, contexts, outcomes
// Schema is OUTPUT - types emerge from usage patterns
export const entity = sqliteTable(
  "entity",
  {
    id: text("id").primaryKey(),

    // Identity
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(), // lowercase, trimmed for matching
    entityType: text("entity_type"), // topic, misconception, strategy, constraint, context, outcome
    description: text("description"),

    // Aggregate stats (across all contributors)
    touchCount: integer("touch_count").notNull().default(0),
    trajectoryCount: integer("trajectory_count").notNull().default(0),
    contributorCount: integer("contributor_count").notNull().default(0),

    // Embeddings and metadata
    embedding: blob("embedding"),
    metadata: text("metadata"), // JSON

    // Timestamps
    firstSeen: integer("first_seen", { mode: "timestamp" }).notNull(),
    lastSeen: integer("last_seen", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("entity_name_idx").on(table.normalizedName),
    index("entity_type_idx").on(table.entityType),
    index("entity_touch_idx").on(table.touchCount),
  ]
);

// Entity contributions - provenance tracking
// Links instructors to the entities they've touched/contributed
export const entityContribution = sqliteTable(
  "entity_contribution",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id")
      .notNull()
      .references(() => entity.id, { onDelete: "cascade" }),
    nearAccountId: text("near_account_id").notNull(),

    // First trajectory where this contributor touched this entity
    firstTrajectoryId: text("first_trajectory_id")
      .notNull()
      .references(() => trajectory.id),

    // Contributor-specific stats
    touchCount: integer("touch_count").notNull().default(1),
    trajectoryCount: integer("trajectory_count").notNull().default(1),

    // Timestamps
    firstSeen: integer("first_seen", { mode: "timestamp" }).notNull(),
    lastSeen: integer("last_seen", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("contribution_entity_idx").on(table.entityId),
    index("contribution_account_idx").on(table.nearAccountId),
    index("contribution_pair_idx").on(table.entityId, table.nearAccountId),
  ]
);

// Edges - relationships discovered through co-occurrence
// Aggregated across all contributors
export const edge = sqliteTable(
  "edge",
  {
    id: text("id").primaryKey(),
    sourceEntityId: text("source_entity_id")
      .notNull()
      .references(() => entity.id, { onDelete: "cascade" }),
    targetEntityId: text("target_entity_id")
      .notNull()
      .references(() => entity.id, { onDelete: "cascade" }),

    // Relationship (emerges from patterns)
    relationshipType: text("relationship_type"),

    // Aggregate evidence
    weight: integer("weight").notNull().default(1),
    trajectoryCount: integer("trajectory_count").notNull().default(1),
    contributorCount: integer("contributor_count").notNull().default(1),

    // Outcome tracking (for strategy/approach edges)
    // Populated when trajectories include outcome entities
    positiveOutcomes: integer("positive_outcomes").notNull().default(0),
    negativeOutcomes: integer("negative_outcomes").notNull().default(0),
    mixedOutcomes: integer("mixed_outcomes").notNull().default(0),

    // Timestamps
    firstSeen: integer("first_seen", { mode: "timestamp" }).notNull(),
    lastSeen: integer("last_seen", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("edge_source_idx").on(table.sourceEntityId),
    index("edge_target_idx").on(table.targetEntityId),
    index("edge_pair_idx").on(table.sourceEntityId, table.targetEntityId),
    index("edge_type_idx").on(table.relationshipType),
    index("edge_weight_idx").on(table.weight),
  ]
);

// Co-occurrence matrix - for structural embeddings
// Global: entities that co-occur in walks across all contributors
export const cooccurrence = sqliteTable(
  "cooccurrence",
  {
    id: text("id").primaryKey(),
    entityA: text("entity_a")
      .notNull()
      .references(() => entity.id, { onDelete: "cascade" }),
    entityB: text("entity_b")
      .notNull()
      .references(() => entity.id, { onDelete: "cascade" }),

    // Aggregate counts
    count: integer("count").notNull().default(0),
    windowCount: integer("window_count").notNull().default(0),
    trajectoryCount: integer("trajectory_count").notNull().default(0),
    contributorCount: integer("contributor_count").notNull().default(0),

    lastUpdated: integer("last_updated", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("cooccurrence_pair_idx").on(table.entityA, table.entityB),
    index("cooccurrence_a_idx").on(table.entityA),
    index("cooccurrence_b_idx").on(table.entityB),
  ]
);

// =============================================================================
// LEGACY: Key-Value Store (example from template)
// =============================================================================

export const kvStore = sqliteTable("key_value_store", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  nearAccountId: text("near_account_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
