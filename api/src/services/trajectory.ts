/**
 * Trajectory Capture Engine
 *
 * The agent as informed walker. This service captures trajectories - complete
 * walks through the PCK context graph as the agent solves problems.
 *
 * Key concepts:
 * - Each trajectory = one informed walk through problem space
 * - Events are logged as the agent "touches" entities
 * - Trajectories are the source data for structural embeddings
 * - Entities are GLOBAL (shared PCK context graph)
 * - Entity contributions track provenance (which instructor touched what)
 */

import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Database as DrizzleDatabase } from "../db";
import * as schema from "../db/schema";

// Hash function for finding similar inputs
function hashInput(input: string): string {
  // Simple hash - in production, use a proper semantic hash
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

export type EventType = "touch" | "reason" | "decide" | "discover";

/**
 * Decision context captured at event time.
 * This is the "why" that makes decision traces valuable.
 */
export interface DecisionContext {
  // What triggered this decision point
  trigger?: string;

  // What the teacher observed/noticed
  observations?: string[];

  // What options were considered (if any)
  alternatives?: string[];

  // Why this choice was made
  rationale?: string;

  // What constraints influenced the decision
  constraints?: string[];

  // Expected outcome (for later comparison)
  expectedOutcome?: string;

  // Any relevant prior experience referenced
  priorExperience?: string;
}

export interface TrajectoryEvent {
  type: EventType;
  entityId?: string;
  data?: Record<string, unknown>;
  // Structured decision context
  context?: DecisionContext;
}

export interface TrajectoryInfo {
  id: string;
  inputText: string;
  summary: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface EntityInfo {
  id: string;
  name: string;
  entityType: string | null;
  description: string | null;
  touchCount: number;
}

export interface EdgeInfo {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: string | null;
  weight: number;
}

export class TrajectoryEngine {
  private sequenceCounters: Map<string, number> = new Map();

  constructor(private db: DrizzleDatabase) {}

  /**
   * Start a new trajectory (walk begins)
   */
  async startTrajectory(
    nearAccountId: string,
    inputText: string,
    conversationId?: string
  ): Promise<string> {
    const id = nanoid();
    const now = new Date();

    await this.db.insert(schema.trajectory).values({
      id,
      nearAccountId,
      conversationId: conversationId ?? null,
      inputText,
      inputHash: hashInput(inputText),
      startedAt: now,
    });

    this.sequenceCounters.set(id, 0);

    return id;
  }

  /**
   * Log an event during the trajectory (the walk continues)
   */
  async logEvent(
    trajectoryId: string,
    event: TrajectoryEvent
  ): Promise<string> {
    const id = nanoid();
    const now = new Date();
    const sequenceNum = this.sequenceCounters.get(trajectoryId) ?? 0;
    this.sequenceCounters.set(trajectoryId, sequenceNum + 1);

    // Merge context into data for storage
    const dataToStore = event.data ? { ...event.data } : {};
    if (event.context) {
      dataToStore._context = event.context;
    }

    await this.db.insert(schema.event).values({
      id,
      trajectoryId,
      sequenceNum,
      timestamp: now,
      eventType: event.type,
      entityId: event.entityId ?? null,
      data: Object.keys(dataToStore).length > 0 ? JSON.stringify(dataToStore) : null,
    });

    // If touching an entity, update its touch count
    if (event.type === "touch" && event.entityId) {
      await this.db
        .update(schema.entity)
        .set({
          touchCount: sql`${schema.entity.touchCount} + 1`,
          lastSeen: now,
        })
        .where(eq(schema.entity.id, event.entityId));
    }

    return id;
  }

  /**
   * Find or create a global entity by name and type.
   * Entities are shared across all contributors.
   * Tracks contributor provenance via entityContribution.
   */
  async findOrCreateEntity(
    nearAccountId: string,
    trajectoryId: string,
    name: string,
    entityType?: string,
    description?: string
  ): Promise<string> {
    const normalizedName = name.toLowerCase().trim();
    const now = new Date();

    // Try to find existing global entity
    const [existing] = await this.db
      .select()
      .from(schema.entity)
      .where(eq(schema.entity.normalizedName, normalizedName))
      .limit(1);

    let entityId: string;

    if (existing) {
      entityId = existing.id;

      // Update entity stats
      await this.db
        .update(schema.entity)
        .set({
          touchCount: sql`${schema.entity.touchCount} + 1`,
          lastSeen: now,
          // Update type if not set and we have one
          ...(entityType && !existing.entityType ? { entityType } : {}),
          // Update description if not set and we have one
          ...(description && !existing.description ? { description } : {}),
        })
        .where(eq(schema.entity.id, entityId));
    } else {
      // Create new global entity
      entityId = nanoid();

      await this.db.insert(schema.entity).values({
        id: entityId,
        name,
        normalizedName,
        entityType: entityType ?? null,
        description: description ?? null,
        touchCount: 1,
        trajectoryCount: 1,
        contributorCount: 1,
        firstSeen: now,
        lastSeen: now,
      });
    }

    // Track contributor provenance
    await this.trackContribution(entityId, nearAccountId, trajectoryId, now);

    return entityId;
  }

  /**
   * Track that a contributor touched an entity.
   * Updates or creates entityContribution record.
   */
  private async trackContribution(
    entityId: string,
    nearAccountId: string,
    trajectoryId: string,
    timestamp: Date
  ): Promise<void> {
    const [existing] = await this.db
      .select()
      .from(schema.entityContribution)
      .where(
        and(
          eq(schema.entityContribution.entityId, entityId),
          eq(schema.entityContribution.nearAccountId, nearAccountId)
        )
      )
      .limit(1);

    if (existing) {
      // Update existing contribution
      await this.db
        .update(schema.entityContribution)
        .set({
          touchCount: existing.touchCount + 1,
          lastSeen: timestamp,
        })
        .where(eq(schema.entityContribution.id, existing.id));
    } else {
      // New contributor for this entity
      await this.db.insert(schema.entityContribution).values({
        id: nanoid(),
        entityId,
        nearAccountId,
        firstTrajectoryId: trajectoryId,
        touchCount: 1,
        trajectoryCount: 1,
        firstSeen: timestamp,
        lastSeen: timestamp,
      });

      // Increment contributor count on entity
      await this.db
        .update(schema.entity)
        .set({
          contributorCount: sql`${schema.entity.contributorCount} + 1`,
        })
        .where(eq(schema.entity.id, entityId));
    }
  }

  /**
   * Complete a trajectory (walk ends)
   * Updates embeddings and strengthens edges based on co-occurrence
   */
  async completeTrajectory(
    trajectoryId: string,
    nearAccountId: string,
    summary?: string
  ): Promise<{
    entitiesDiscovered: EntityInfo[];
    entitiesTouched: EntityInfo[];
    edgesTraversed: EdgeInfo[];
  }> {
    const now = new Date();

    // Mark trajectory as complete
    await this.db
      .update(schema.trajectory)
      .set({
        completedAt: now,
        summary: summary ?? null,
      })
      .where(eq(schema.trajectory.id, trajectoryId));

    // Get all events with entity touches
    const events = await this.db
      .select()
      .from(schema.event)
      .where(eq(schema.event.trajectoryId, trajectoryId))
      .orderBy(schema.event.sequenceNum);

    // Collect unique entity IDs
    const touchedEntityIds = [
      ...new Set(
        events
          .filter((e) => e.eventType === "touch" && e.entityId)
          .map((e) => e.entityId as string)
      ),
    ];

    const discoveredEntityIds = [
      ...new Set(
        events
          .filter((e) => e.eventType === "discover" && e.entityId)
          .map((e) => e.entityId as string)
      ),
    ];

    const allEntityIds = [
      ...new Set([...touchedEntityIds, ...discoveredEntityIds]),
    ];

    // Update trajectory counts on entities
    if (allEntityIds.length > 0) {
      await this.db
        .update(schema.entity)
        .set({
          trajectoryCount: sql`${schema.entity.trajectoryCount} + 1`,
        })
        .where(inArray(schema.entity.id, allEntityIds));
    }

    // Update trajectory counts on contributions
    for (const entityId of allEntityIds) {
      await this.db
        .update(schema.entityContribution)
        .set({
          trajectoryCount: sql`${schema.entityContribution.trajectoryCount} + 1`,
        })
        .where(
          and(
            eq(schema.entityContribution.entityId, entityId),
            eq(schema.entityContribution.nearAccountId, nearAccountId)
          )
        );
    }

    // Update co-occurrence matrix (global)
    await this.updateCooccurrences(
      allEntityIds,
      trajectoryId,
      nearAccountId,
      now
    );

    // Strengthen edges between consecutive touches
    const edgesTraversed = await this.strengthenEdges(
      touchedEntityIds,
      trajectoryId,
      nearAccountId,
      now
    );

    // Track outcome associations
    await this.trackOutcomes(allEntityIds, now);

    // Get entity details
    const entities =
      allEntityIds.length > 0
        ? await this.db
            .select()
            .from(schema.entity)
            .where(inArray(schema.entity.id, allEntityIds))
        : [];

    const entityMap = new Map(entities.map((e) => [e.id, e]));

    const entitiesTouched: EntityInfo[] = touchedEntityIds
      .map((id) => entityMap.get(id))
      .filter((e): e is (typeof entities)[0] => e !== undefined)
      .map((e) => ({
        id: e.id,
        name: e.name,
        entityType: e.entityType,
        description: e.description,
        touchCount: e.touchCount,
      }));

    const entitiesDiscovered: EntityInfo[] = discoveredEntityIds
      .map((id) => entityMap.get(id))
      .filter((e): e is (typeof entities)[0] => e !== undefined)
      .map((e) => ({
        id: e.id,
        name: e.name,
        entityType: e.entityType,
        description: e.description,
        touchCount: e.touchCount,
      }));

    // Cleanup
    this.sequenceCounters.delete(trajectoryId);

    return {
      entitiesDiscovered,
      entitiesTouched,
      edgesTraversed,
    };
  }

  /**
   * Get trajectory by ID
   */
  async getTrajectory(id: string): Promise<{
    trajectory: TrajectoryInfo;
    events: Array<{
      id: string;
      sequenceNum: number;
      timestamp: Date;
      eventType: EventType;
      entityId: string | null;
      data: Record<string, unknown> | null;
    }>;
    entitiesTouched: EntityInfo[];
  } | null> {
    const [trajectory] = await this.db
      .select()
      .from(schema.trajectory)
      .where(eq(schema.trajectory.id, id))
      .limit(1);

    if (!trajectory) {
      return null;
    }

    const events = await this.db
      .select()
      .from(schema.event)
      .where(eq(schema.event.trajectoryId, id))
      .orderBy(schema.event.sequenceNum);

    const entityIds = events
      .filter((e) => e.entityId)
      .map((e) => e.entityId as string);

    const entities =
      entityIds.length > 0
        ? await this.db
            .select()
            .from(schema.entity)
            .where(inArray(schema.entity.id, entityIds))
        : [];

    return {
      trajectory: {
        id: trajectory.id,
        inputText: trajectory.inputText,
        summary: trajectory.summary,
        startedAt: trajectory.startedAt,
        completedAt: trajectory.completedAt,
      },
      events: events.map((e) => ({
        id: e.id,
        sequenceNum: e.sequenceNum,
        timestamp: e.timestamp,
        eventType: e.eventType as EventType,
        entityId: e.entityId,
        data: e.data ? JSON.parse(e.data) : null,
      })),
      entitiesTouched: entities.map((e) => ({
        id: e.id,
        name: e.name,
        entityType: e.entityType,
        description: e.description,
        touchCount: e.touchCount,
      })),
    };
  }

  /**
   * List trajectories
   */
  async listTrajectories(
    nearAccountId: string,
    limit: number = 20,
    conversationId?: string
  ): Promise<TrajectoryInfo[]> {
    const conditions = [eq(schema.trajectory.nearAccountId, nearAccountId)];

    if (conversationId) {
      conditions.push(eq(schema.trajectory.conversationId, conversationId));
    }

    const trajectories = await this.db
      .select()
      .from(schema.trajectory)
      .where(and(...conditions))
      .orderBy(desc(schema.trajectory.startedAt))
      .limit(limit);

    return trajectories.map((t) => ({
      id: t.id,
      inputText: t.inputText,
      summary: t.summary,
      startedAt: t.startedAt,
      completedAt: t.completedAt,
    }));
  }

  /**
   * Update co-occurrence matrix for entities that appeared in the same trajectory (global)
   */
  private async updateCooccurrences(
    entityIds: string[],
    trajectoryId: string,
    nearAccountId: string,
    timestamp: Date
  ): Promise<void> {
    if (entityIds.length < 2) return;

    // For each pair of entities
    for (let i = 0; i < entityIds.length; i++) {
      for (let j = i + 1; j < entityIds.length; j++) {
        const idI = entityIds[i];
        const idJ = entityIds[j];
        if (!idI || !idJ) continue;

        const sorted = [idI, idJ].sort();
        const entityA = sorted[0]!;
        const entityB = sorted[1]!;
        const coocId = `${entityA}:${entityB}`;

        // Upsert co-occurrence
        const [existing] = await this.db
          .select()
          .from(schema.cooccurrence)
          .where(eq(schema.cooccurrence.id, coocId))
          .limit(1);

        if (existing) {
          await this.db
            .update(schema.cooccurrence)
            .set({
              count: existing.count + 1,
              windowCount: existing.windowCount + 1,
              trajectoryCount: existing.trajectoryCount + 1,
              lastUpdated: timestamp,
            })
            .where(eq(schema.cooccurrence.id, coocId));
        } else {
          await this.db.insert(schema.cooccurrence).values({
            id: coocId,
            entityA,
            entityB,
            count: 1,
            windowCount: 1,
            trajectoryCount: 1,
            contributorCount: 1,
            lastUpdated: timestamp,
          });
        }
      }
    }
  }

  /**
   * Strengthen edges between consecutively touched entities (global)
   */
  private async strengthenEdges(
    entityIds: string[],
    trajectoryId: string,
    nearAccountId: string,
    timestamp: Date
  ): Promise<EdgeInfo[]> {
    if (entityIds.length < 2) return [];

    const edges: EdgeInfo[] = [];

    for (let i = 0; i < entityIds.length - 1; i++) {
      const sourceId = entityIds[i];
      const targetId = entityIds[i + 1];
      if (!sourceId || !targetId || sourceId === targetId) continue;

      const edgeId = `${sourceId}:${targetId}`;

      const [existing] = await this.db
        .select()
        .from(schema.edge)
        .where(eq(schema.edge.id, edgeId))
        .limit(1);

      if (existing) {
        await this.db
          .update(schema.edge)
          .set({
            weight: existing.weight + 1,
            trajectoryCount: existing.trajectoryCount + 1,
            lastSeen: timestamp,
          })
          .where(eq(schema.edge.id, edgeId));

        edges.push({
          id: existing.id,
          sourceEntityId: existing.sourceEntityId,
          targetEntityId: existing.targetEntityId,
          relationshipType: existing.relationshipType,
          weight: existing.weight + 1,
        });
      } else {
        await this.db.insert(schema.edge).values({
          id: edgeId,
          sourceEntityId: sourceId,
          targetEntityId: targetId,
          weight: 1,
          trajectoryCount: 1,
          contributorCount: 1,
          positiveOutcomes: 0,
          negativeOutcomes: 0,
          mixedOutcomes: 0,
          firstSeen: timestamp,
          lastSeen: timestamp,
        });

        edges.push({
          id: edgeId,
          sourceEntityId: sourceId,
          targetEntityId: targetId,
          relationshipType: null,
          weight: 1,
        });
      }
    }

    return edges;
  }

  /**
   * Track outcome associations.
   * When a trajectory includes outcome entities, update edges
   * from strategies to outcomes.
   * Edge weights accumulate naturally - no valence classification needed.
   */
  private async trackOutcomes(
    entityIds: string[],
    timestamp: Date
  ): Promise<void> {
    if (entityIds.length === 0) return;

    // Get entity types
    const entities = await this.db
      .select()
      .from(schema.entity)
      .where(inArray(schema.entity.id, entityIds));

    const outcomes = entities.filter((e) => e.entityType === "outcome");
    const strategies = entities.filter((e) => e.entityType === "strategy");

    if (outcomes.length === 0 || strategies.length === 0) return;

    // For each strategy-outcome pair in this trajectory
    for (const strategy of strategies) {
      for (const outcome of outcomes) {
        const edgeId = `${strategy.id}:${outcome.id}`;

        const [existing] = await this.db
          .select()
          .from(schema.edge)
          .where(eq(schema.edge.id, edgeId))
          .limit(1);

        if (existing) {
          await this.db
            .update(schema.edge)
            .set({
              weight: existing.weight + 1,
              trajectoryCount: existing.trajectoryCount + 1,
              lastSeen: timestamp,
            })
            .where(eq(schema.edge.id, edgeId));
        } else {
          await this.db.insert(schema.edge).values({
            id: edgeId,
            sourceEntityId: strategy.id,
            targetEntityId: outcome.id,
            relationshipType: "leads_to",
            weight: 1,
            trajectoryCount: 1,
            contributorCount: 1,
            positiveOutcomes: 0,
            negativeOutcomes: 0,
            mixedOutcomes: 0,
            firstSeen: timestamp,
            lastSeen: timestamp,
          });
        }
      }
    }
  }
}
