/**
 * Structural Embeddings Service
 *
 * Node2vec-inspired approach - structure from walks, not semantics.
 * Entities that co-occur in walks → closer in embedding space.
 *
 * For MVP: Simple co-occurrence matrix + cosine similarity
 * Future: Proper node2vec or graph neural network
 */

import { eq, sql, and, or, desc, gte } from 'drizzle-orm';
import type { Database as DrizzleDatabase } from '../db';
import * as schema from '../db/schema';

export interface SimilarEntity {
  entityId: string;
  name: string;
  entityType: string | null;
  similarity: number;
}

export class EmbeddingService {
  constructor(private db: DrizzleDatabase) {}

  /**
   * Get structurally similar entities based on co-occurrence patterns
   * "These entities get touched together when solving problems"
   */
  async findSimilarEntities(
    entityId: string,
    limit: number = 10
  ): Promise<SimilarEntity[]> {
    // Find all co-occurrences involving this entity
    const cooccurrences = await this.db
      .select()
      .from(schema.cooccurrence)
      .where(
        or(
          eq(schema.cooccurrence.entityA, entityId),
          eq(schema.cooccurrence.entityB, entityId)
        )
      )
      .orderBy(desc(schema.cooccurrence.count))
      .limit(limit);

    if (cooccurrences.length === 0) {
      return [];
    }

    // Get the related entity IDs
    const relatedIds = cooccurrences.map(c =>
      c.entityA === entityId ? c.entityB : c.entityA
    );

    // Get entity details
    const entities = await this.db
      .select()
      .from(schema.entity)
      .where(sql`${schema.entity.id} IN (${sql.join(relatedIds.map(id => sql`${id}`), sql`, `)})`);

    const entityMap = new Map(entities.map(e => [e.id, e]));

    // Calculate max count for normalization
    const maxCount = Math.max(...cooccurrences.map(c => c.count));

    return cooccurrences
      .map(c => {
        const otherId = c.entityA === entityId ? c.entityB : c.entityA;
        const entity = entityMap.get(otherId);
        if (!entity) return null;

        return {
          entityId: otherId,
          name: entity.name,
          entityType: entity.entityType,
          similarity: c.count / maxCount, // Normalized 0-1
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  /**
   * Get structural similarity between two entities
   * Based on shared co-occurrence neighborhoods
   */
  async structuralSimilarity(entityA: string, entityB: string): Promise<number> {
    // Get co-occurrence neighbors of A
    const neighborsA = await this.getCooccurrenceNeighbors(entityA);
    const setA = new Set(neighborsA.map(n => n.entityId));

    // Get co-occurrence neighbors of B
    const neighborsB = await this.getCooccurrenceNeighbors(entityB);
    const setB = new Set(neighborsB.map(n => n.entityId));

    // Jaccard similarity of neighborhoods
    const intersection = [...setA].filter(x => setB.has(x)).length;
    const union = new Set([...setA, ...setB]).size;

    if (union === 0) return 0;

    return intersection / union;
  }

  /**
   * Predict likely next entities given a current walk
   * Based on co-occurrence patterns (global entities)
   */
  async predictNextEntities(
    currentWalk: string[],
    limit: number = 5
  ): Promise<Array<{
    entityId: string;
    name: string;
    confidence: number;
  }>> {
    if (currentWalk.length === 0) {
      return [];
    }

    // Weight recent entities more heavily
    const entityScores = new Map<string, number>();
    const walkSet = new Set(currentWalk);

    for (let i = 0; i < currentWalk.length; i++) {
      const entityId = currentWalk[i];
      if (!entityId) continue;

      const recency = (i + 1) / currentWalk.length; // More recent = higher weight

      // Get co-occurrences for this entity
      const coocs = await this.db
        .select()
        .from(schema.cooccurrence)
        .where(
          or(
            eq(schema.cooccurrence.entityA, entityId),
            eq(schema.cooccurrence.entityB, entityId)
          )
        );

      for (const cooc of coocs) {
        const otherId = cooc.entityA === entityId ? cooc.entityB : cooc.entityA;

        // Skip if already in walk
        if (walkSet.has(otherId)) continue;

        const score = cooc.count * recency;
        entityScores.set(otherId, (entityScores.get(otherId) ?? 0) + score);
      }
    }

    if (entityScores.size === 0) {
      return [];
    }

    // Sort by score
    const sorted = [...entityScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    if (sorted.length === 0) {
      return [];
    }

    // Normalize scores to confidence
    const maxScore = sorted[0]![1];

    // Get entity names (entities are global, no user filter)
    const entityIds = sorted.map(([id]) => id);
    const entities = await this.db
      .select()
      .from(schema.entity)
      .where(
        sql`${schema.entity.id} IN (${sql.join(entityIds.map(id => sql`${id}`), sql`, `)})`
      );

    const entityMap = new Map(entities.map(e => [e.id, e]));

    return sorted
      .map(([id, score]) => {
        const entity = entityMap.get(id);
        if (!entity) return null;

        return {
          entityId: id,
          name: entity.name,
          confidence: score / maxScore,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  /**
   * Get entities that are structurally equivalent
   * (Similar neighborhoods, even if not directly connected, global entities)
   */
  async findStructurallyEquivalentEntities(
    entityId: string,
    limit: number = 5
  ): Promise<SimilarEntity[]> {
    // Get neighborhood of target entity
    const targetNeighbors = await this.getCooccurrenceNeighbors(entityId);
    const targetSet = new Set(targetNeighbors.map(n => n.entityId));

    if (targetSet.size === 0) {
      return [];
    }

    // Get all entities (global, no user filter)
    const allEntities = await this.db
      .select()
      .from(schema.entity)
      .where(gte(schema.entity.touchCount, 1));

    // Calculate structural similarity for each
    const similarities: Array<{
      entity: typeof allEntities[0];
      similarity: number;
    }> = [];

    for (const entity of allEntities) {
      if (entity.id === entityId) continue;

      const similarity = await this.structuralSimilarity(entityId, entity.id);
      if (similarity > 0) {
        similarities.push({ entity, similarity });
      }
    }

    // Sort by similarity
    similarities.sort((a, b) => b.similarity - a.similarity);

    return similarities.slice(0, limit).map(({ entity, similarity }) => ({
      entityId: entity.id,
      name: entity.name,
      entityType: entity.entityType,
      similarity,
    }));
  }

  /**
   * Get co-occurrence neighbors for an entity
   */
  private async getCooccurrenceNeighbors(entityId: string): Promise<Array<{
    entityId: string;
    count: number;
  }>> {
    const cooccurrences = await this.db
      .select()
      .from(schema.cooccurrence)
      .where(
        or(
          eq(schema.cooccurrence.entityA, entityId),
          eq(schema.cooccurrence.entityB, entityId)
        )
      );

    return cooccurrences.map(c => ({
      entityId: c.entityA === entityId ? c.entityB : c.entityA,
      count: c.count,
    }));
  }
}
