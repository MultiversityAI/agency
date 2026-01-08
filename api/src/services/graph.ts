/**
 * Graph Service
 *
 * Query the emergent context graph structure.
 * Nodes = entities discovered through traversal
 * Edges = relationships discovered through co-occurrence
 */

import { eq, desc, gte, and, or, sql, inArray } from 'drizzle-orm';
import type { Database as DrizzleDatabase } from '../db';
import * as schema from '../db/schema';

export interface GraphNode {
  id: string;
  name: string;
  entityType: string | null;
  touchCount: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relationshipType: string | null;
  weight: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export class GraphService {
  constructor(private db: DrizzleDatabase) {}

  /**
   * Get graph data for visualization
   */
  async getGraph(
    nearAccountId: string,
    options: {
      centerEntityId?: string;
      depth?: number;
      minWeight?: number;
    } = {}
  ): Promise<GraphData> {
    const { centerEntityId, depth = 2, minWeight = 0 } = options;

    if (centerEntityId) {
      // Get subgraph centered on a specific entity
      return this.getSubgraph(nearAccountId, centerEntityId, depth, minWeight);
    }

    // Get full graph for the user
    return this.getFullGraph(nearAccountId, minWeight);
  }

  /**
   * Get subgraph centered on a specific entity
   */
  private async getSubgraph(
    nearAccountId: string,
    centerEntityId: string,
    depth: number,
    minWeight: number
  ): Promise<GraphData> {
    const visited = new Set<string>();
    const nodesToProcess = [centerEntityId];
    const allNodeIds = new Set<string>();
    const allEdges: GraphEdge[] = [];

    // BFS to depth
    for (let d = 0; d < depth && nodesToProcess.length > 0; d++) {
      const currentBatch = [...nodesToProcess];
      nodesToProcess.length = 0;

      for (const nodeId of currentBatch) {
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);
        allNodeIds.add(nodeId);

        // Get edges from this node
        const edges = await this.db
          .select()
          .from(schema.edge)
          .where(
            and(
              or(
                eq(schema.edge.sourceEntityId, nodeId),
                eq(schema.edge.targetEntityId, nodeId)
              ),
              gte(schema.edge.weight, minWeight)
            )
          );

        for (const edge of edges) {
          const otherId = edge.sourceEntityId === nodeId
            ? edge.targetEntityId
            : edge.sourceEntityId;

          allNodeIds.add(otherId);

          // Avoid duplicate edges
          if (!allEdges.some(e => e.id === edge.id)) {
            allEdges.push({
              id: edge.id,
              source: edge.sourceEntityId,
              target: edge.targetEntityId,
              relationshipType: edge.relationshipType,
              weight: edge.weight,
            });
          }

          if (!visited.has(otherId)) {
            nodesToProcess.push(otherId);
          }
        }
      }
    }

    // Get node details (entities are global)
    const nodeIdArray = [...allNodeIds];
    const nodes = nodeIdArray.length > 0
      ? await this.db
          .select()
          .from(schema.entity)
          .where(inArray(schema.entity.id, nodeIdArray))
      : [];

    return {
      nodes: nodes.map(n => ({
        id: n.id,
        name: n.name,
        entityType: n.entityType,
        touchCount: n.touchCount,
      })),
      edges: allEdges,
    };
  }

  /**
   * Get full graph for user (entities from user's trajectories)
   */
  private async getFullGraph(
    nearAccountId: string,
    minWeight: number
  ): Promise<GraphData> {
    // Get user's trajectories
    const trajectories = await this.db
      .select({ id: schema.trajectory.id })
      .from(schema.trajectory)
      .where(eq(schema.trajectory.nearAccountId, nearAccountId));

    if (trajectories.length === 0) {
      return { nodes: [], edges: [] };
    }

    const trajectoryIds = trajectories.map(t => t.id);

    // Get entities from user's events
    const events = await this.db
      .select({ entityId: schema.event.entityId })
      .from(schema.event)
      .where(
        and(
          inArray(schema.event.trajectoryId, trajectoryIds),
          sql`${schema.event.entityId} IS NOT NULL`
        )
      );

    const entityIds = [...new Set(events.map(e => e.entityId).filter((id): id is string => id !== null))];

    if (entityIds.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Get entity details
    const entities = await this.db
      .select()
      .from(schema.entity)
      .where(inArray(schema.entity.id, entityIds));

    // Get all edges between these entities
    const edges = await this.db
      .select()
      .from(schema.edge)
      .where(
        and(
          inArray(schema.edge.sourceEntityId, entityIds),
          inArray(schema.edge.targetEntityId, entityIds),
          gte(schema.edge.weight, minWeight)
        )
      );

    return {
      nodes: entities.map(n => ({
        id: n.id,
        name: n.name,
        entityType: n.entityType,
        touchCount: n.touchCount,
      })),
      edges: edges.map(e => ({
        id: e.id,
        source: e.sourceEntityId,
        target: e.targetEntityId,
        relationshipType: e.relationshipType,
        weight: e.weight,
      })),
    };
  }

  /**
   * Get entity details with connections
   */
  async getEntity(
    nearAccountId: string,
    entityId: string
  ): Promise<{
    entity: {
      id: string;
      name: string;
      entityType: string | null;
      description: string | null;
      touchCount: number;
      metadata: unknown;
      firstSeen: string;
      lastSeen: string;
    };
    connectedEntities: Array<{
      entity: {
        id: string;
        name: string;
        entityType: string | null;
        description: string | null;
        touchCount: number;
      };
      relationship: string | null;
      weight: number;
    }>;
    recentTrajectories: Array<{
      id: string;
      inputText: string;
      summary: string | null;
      startedAt: string;
      completedAt: string | null;
    }>;
  } | null> {
    // Get entity (entities are global, verify user has touched it)
    const [entity] = await this.db
      .select()
      .from(schema.entity)
      .where(eq(schema.entity.id, entityId))
      .limit(1);

    if (!entity) {
      return null;
    }

    // Verify user has touched this entity through their trajectories
    const userTrajectories = await this.db
      .select({ id: schema.trajectory.id })
      .from(schema.trajectory)
      .where(eq(schema.trajectory.nearAccountId, nearAccountId));

    const trajectoryIds = userTrajectories.map(t => t.id);

    if (trajectoryIds.length > 0) {
      const [userEvent] = await this.db
        .select()
        .from(schema.event)
        .where(
          and(
            eq(schema.event.entityId, entityId),
            inArray(schema.event.trajectoryId, trajectoryIds)
          )
        )
        .limit(1);

      if (!userEvent) {
        // User hasn't touched this entity
        return null;
      }
    } else {
      // No trajectories for this user
      return null;
    }

    // Get connected entities via edges
    const edges = await this.db
      .select()
      .from(schema.edge)
      .where(
        or(
          eq(schema.edge.sourceEntityId, entityId),
          eq(schema.edge.targetEntityId, entityId)
        )
      )
      .orderBy(desc(schema.edge.weight));

    const connectedIds = edges.map(e =>
      e.sourceEntityId === entityId ? e.targetEntityId : e.sourceEntityId
    );

    const connectedEntities = connectedIds.length > 0
      ? await this.db
          .select()
          .from(schema.entity)
          .where(inArray(schema.entity.id, connectedIds))
      : [];

    const connectedMap = new Map(connectedEntities.map(e => [e.id, e]));

    // Get recent trajectories touching this entity
    const events = await this.db
      .select()
      .from(schema.event)
      .where(eq(schema.event.entityId, entityId))
      .orderBy(desc(schema.event.timestamp))
      .limit(10);

    const recentTrajectoryIds = [...new Set(events.map(e => e.trajectoryId))].slice(0, 5);

    const trajectories = recentTrajectoryIds.length > 0
      ? await this.db
          .select()
          .from(schema.trajectory)
          .where(inArray(schema.trajectory.id, recentTrajectoryIds))
      : [];

    return {
      entity: {
        id: entity.id,
        name: entity.name,
        entityType: entity.entityType,
        description: entity.description,
        touchCount: entity.touchCount,
        metadata: entity.metadata ? JSON.parse(entity.metadata) : null,
        firstSeen: entity.firstSeen.toISOString(),
        lastSeen: entity.lastSeen.toISOString(),
      },
      connectedEntities: edges.map(e => {
        const otherId = e.sourceEntityId === entityId ? e.targetEntityId : e.sourceEntityId;
        const other = connectedMap.get(otherId);
        return {
          entity: other ? {
            id: other.id,
            name: other.name,
            entityType: other.entityType,
            description: other.description,
            touchCount: other.touchCount,
          } : {
            id: otherId,
            name: 'Unknown',
            entityType: null,
            description: null,
            touchCount: 0,
          },
          relationship: e.relationshipType,
          weight: e.weight,
        };
      }),
      recentTrajectories: trajectories.map(t => ({
        id: t.id,
        inputText: t.inputText,
        summary: t.summary,
        startedAt: t.startedAt.toISOString(),
        completedAt: t.completedAt?.toISOString() ?? null,
      })),
    };
  }
}
