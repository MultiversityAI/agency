/**
 * Graph Reasoning Service - World Model Simulator
 *
 * Performs inference over accumulated graph structure.
 *
 * KEY DISTINCTION:
 * - Trajectories = training data (event clock, append-only)
 * - Graph structure = world model (edges, weights, co-occurrences)
 * - Simulation queries the MODEL, not the training data
 *
 * The "physics" is encoded in:
 * - Edge weights: How often entities co-occur in walks
 * - Outcome edges: strategy → outcome with success/failure counts
 * - Co-occurrence: Which entities appear together (structural patterns)
 *
 * Simulation = traversing edges and inferring outcomes from accumulated weights.
 */

import { eq, and, or, desc, inArray, sql } from 'drizzle-orm';
import type { Database as DrizzleDatabase } from '../db';
import * as schema from '../db/schema';

// =============================================================================
// TYPES
// =============================================================================

export interface EntityInput {
  name: string;
  type?: string;
}

export interface ResolvedEntity {
  id: string;
  name: string;
  entityType: string | null;
  touchCount: number;
  trajectoryCount: number;
  contributorCount: number;
}

export interface OutcomeProjection {
  outcome: string;
  outcomeId: string;
  probability: number;
  evidence: {
    edgeWeight: number;
    positiveCount: number;
    negativeCount: number;
    mixedCount: number;
    contributorCount: number;
  };
}

export interface Differentiator {
  entity: ResolvedEntity;
  role: 'context' | 'constraint' | 'strategy';
  effect: 'improves' | 'reduces' | 'mixed';
  magnitude: number; // 0-1, how much it shifts outcomes
  cooccurrenceStrength: number; // How often it appears with input entities
  outcomeShift: {
    withEntity: { positiveRate: number; totalWeight: number };
    withoutEntity: { positiveRate: number; totalWeight: number };
  };
}

export interface SimulationResult {
  // Resolved inputs
  input: {
    resolved: ResolvedEntity[];
    unresolved: string[]; // Names we couldn't find
  };

  // Projected outcomes (from edge structure)
  outcomes: OutcomeProjection[];

  // What factors shift outcomes (from co-occurrence structure)
  differentiators: Differentiator[];

  // Simple evidence summary (NOT artificial confidence scoring)
  evidence: {
    totalObservations: number;  // sum of edge weights
    outcomeCount: number;       // number of outcome edges found
    hasPatterns: boolean;       // outcomes.length > 0 || differentiators.length > 0
  };
}

export interface CounterfactualResult {
  original: SimulationResult;
  alternative: SimulationResult;
  change: { from: EntityInput; to: EntityInput };
  comparison: {
    outcomeShifts: Array<{
      outcome: string;
      originalProbability: number;
      alternativeProbability: number;
      delta: number;
    }>;
    netEffect: 'positive' | 'negative' | 'neutral' | 'uncertain';
    recommendation: string;
  };
}

// =============================================================================
// SERVICE
// =============================================================================

export class GraphReasoner {
  constructor(private db: DrizzleDatabase) {}

  // ===========================================================================
  // CORE SIMULATION - Queries graph structure, NOT trajectories
  // ===========================================================================

  /**
   * Simulate outcomes given input entities.
   *
   * This is inference over the world model:
   * 1. Resolve entity names to graph nodes
   * 2. Traverse edges to outcome entities
   * 3. Project distribution from edge weights
   * 4. Find differentiating factors from co-occurrence
   *
   * NO TRAJECTORY QUERIES - only graph structure.
   */
  async simulate(inputs: EntityInput[]): Promise<SimulationResult> {
    // 1. Resolve inputs to graph entities
    const { resolved, unresolved } = await this.resolveEntities(inputs);

    if (resolved.length === 0) {
      return this.emptyResult(inputs, unresolved);
    }

    const entityIds = resolved.map(e => e.id);

    // 2. Project outcomes from EDGE STRUCTURE
    const outcomes = await this.projectOutcomesFromEdges(entityIds);

    // 3. Find differentiators from CO-OCCURRENCE STRUCTURE
    const differentiators = await this.findDifferentiatorsFromStructure(entityIds);

    // 4. Simple evidence summary (no artificial confidence scoring)
    const totalObservations = outcomes.reduce((sum, o) => sum + o.evidence.edgeWeight, 0);

    return {
      input: { resolved, unresolved },
      outcomes,
      differentiators,
      evidence: {
        totalObservations,
        outcomeCount: outcomes.length,
        hasPatterns: outcomes.length > 0 || differentiators.length > 0,
      },
    };
  }

  /**
   * Counterfactual: "What if I used X instead of Y?"
   *
   * Swaps an entity and re-simulates.
   * Works because different entities have different edge neighborhoods.
   */
  async counterfactual(
    baseInputs: EntityInput[],
    change: { from: EntityInput; to: EntityInput }
  ): Promise<CounterfactualResult> {
    // Simulate original
    const original = await this.simulate(baseInputs);

    // Build alternative inputs (swap from → to)
    const alternativeInputs = baseInputs.map(input => {
      const matchesFrom =
        input.name.toLowerCase() === change.from.name.toLowerCase() &&
        (!change.from.type || input.type === change.from.type);
      return matchesFrom ? change.to : input;
    });

    // If no swap happened, add the new entity
    const swapped = alternativeInputs.some((alt, i) =>
      alt.name !== baseInputs[i]?.name
    );
    if (!swapped) {
      // Remove 'from' if present, add 'to'
      const filtered = baseInputs.filter(input =>
        input.name.toLowerCase() !== change.from.name.toLowerCase()
      );
      alternativeInputs.length = 0;
      alternativeInputs.push(...filtered, change.to);
    }

    // Simulate alternative
    const alternative = await this.simulate(alternativeInputs);

    // Compare outcome distributions
    const comparison = this.compareOutcomes(original, alternative, change);

    return { original, alternative, change, comparison };
  }

  // ===========================================================================
  // ENTITY RESOLUTION - Find nodes in graph
  // ===========================================================================

  private async resolveEntities(
    inputs: EntityInput[]
  ): Promise<{ resolved: ResolvedEntity[]; unresolved: string[] }> {
    const resolved: ResolvedEntity[] = [];
    const unresolved: string[] = [];

    for (const input of inputs) {
      const normalized = input.name.toLowerCase().trim();

      // Try exact match
      const conditions = [eq(schema.entity.normalizedName, normalized)];
      if (input.type) {
        conditions.push(eq(schema.entity.entityType, input.type));
      }

      let [entity] = await this.db
        .select()
        .from(schema.entity)
        .where(and(...conditions))
        .limit(1);

      // Try partial match if exact fails
      if (!entity) {
        const partialConditions = [
          sql`${schema.entity.normalizedName} LIKE ${'%' + normalized + '%'}`
        ];
        if (input.type) {
          partialConditions.push(eq(schema.entity.entityType, input.type));
        }

        [entity] = await this.db
          .select()
          .from(schema.entity)
          .where(and(...partialConditions))
          .orderBy(desc(schema.entity.touchCount))
          .limit(1);
      }

      if (entity) {
        resolved.push({
          id: entity.id,
          name: entity.name,
          entityType: entity.entityType,
          touchCount: entity.touchCount,
          trajectoryCount: entity.trajectoryCount,
          contributorCount: entity.contributorCount,
        });
      } else {
        unresolved.push(input.name);
      }
    }

    return { resolved, unresolved };
  }

  // ===========================================================================
  // OUTCOME PROJECTION - From edge structure
  // ===========================================================================

  /**
   * Project outcome distribution from EDGE WEIGHTS.
   *
   * The "physics": edges from input entities to outcome entities.
   * Edge weight = accumulated co-occurrence frequency = evidence.
   *
   * Distribution = normalized edge weights.
   */
  private async projectOutcomesFromEdges(
    inputEntityIds: string[]
  ): Promise<OutcomeProjection[]> {
    // Find edges from input entities to outcome entities
    const outcomeEdges = await this.db
      .select({
        edge: schema.edge,
        outcome: schema.entity,
      })
      .from(schema.edge)
      .innerJoin(
        schema.entity,
        eq(schema.edge.targetEntityId, schema.entity.id)
      )
      .where(
        and(
          inArray(schema.edge.sourceEntityId, inputEntityIds),
          eq(schema.entity.entityType, 'outcome')
        )
      )
      .orderBy(desc(schema.edge.weight));

    if (outcomeEdges.length === 0) {
      return [];
    }

    // Also check edges where input entities are targets (bidirectional)
    const reverseEdges = await this.db
      .select({
        edge: schema.edge,
        outcome: schema.entity,
      })
      .from(schema.edge)
      .innerJoin(
        schema.entity,
        eq(schema.edge.sourceEntityId, schema.entity.id)
      )
      .where(
        and(
          inArray(schema.edge.targetEntityId, inputEntityIds),
          eq(schema.entity.entityType, 'outcome')
        )
      );

    // Combine and dedupe
    const allEdges = [...outcomeEdges, ...reverseEdges];
    const outcomeMap = new Map<string, {
      outcome: typeof schema.entity.$inferSelect;
      totalWeight: number;
      positiveCount: number;
      negativeCount: number;
      mixedCount: number;
      contributorCount: number;
    }>();

    for (const { edge, outcome } of allEdges) {
      const existing = outcomeMap.get(outcome.id);
      if (existing) {
        existing.totalWeight += edge.weight;
        existing.positiveCount += edge.positiveOutcomes;
        existing.negativeCount += edge.negativeOutcomes;
        existing.mixedCount += edge.mixedOutcomes;
        existing.contributorCount = Math.max(existing.contributorCount, edge.contributorCount);
      } else {
        outcomeMap.set(outcome.id, {
          outcome,
          totalWeight: edge.weight,
          positiveCount: edge.positiveOutcomes,
          negativeCount: edge.negativeOutcomes,
          mixedCount: edge.mixedOutcomes,
          contributorCount: edge.contributorCount,
        });
      }
    }

    // Compute total weight for normalization
    const totalWeight = [...outcomeMap.values()].reduce(
      (sum, o) => sum + o.totalWeight, 0
    );

    // Build distribution
    const projections: OutcomeProjection[] = [...outcomeMap.entries()]
      .map(([outcomeId, data]) => ({
        outcome: data.outcome.name,
        outcomeId,
        probability: totalWeight > 0 ? data.totalWeight / totalWeight : 0,
        evidence: {
          edgeWeight: data.totalWeight,
          positiveCount: data.positiveCount,
          negativeCount: data.negativeCount,
          mixedCount: data.mixedCount,
          contributorCount: data.contributorCount,
        },
      }))
      .sort((a, b) => b.probability - a.probability);

    return projections;
  }

  // ===========================================================================
  // DIFFERENTIATORS - From co-occurrence structure
  // ===========================================================================

  /**
   * Find factors that shift outcomes.
   *
   * Uses CO-OCCURRENCE MATRIX to find entities that:
   * 1. Frequently appear with input entities
   * 2. Have different outcome edge patterns
   *
   * This reveals: "Adding context X shifts outcomes toward Y"
   */
  private async findDifferentiatorsFromStructure(
    inputEntityIds: string[]
  ): Promise<Differentiator[]> {
    // Find entities that co-occur with inputs
    const cooccurrences = await this.db
      .select({
        cooc: schema.cooccurrence,
        entity: schema.entity,
      })
      .from(schema.cooccurrence)
      .innerJoin(
        schema.entity,
        or(
          eq(schema.cooccurrence.entityB, schema.entity.id),
          eq(schema.cooccurrence.entityA, schema.entity.id)
        )
      )
      .where(
        and(
          or(
            inArray(schema.cooccurrence.entityA, inputEntityIds),
            inArray(schema.cooccurrence.entityB, inputEntityIds)
          ),
          inArray(schema.entity.entityType, ['context', 'constraint', 'strategy'])
        )
      )
      .orderBy(desc(schema.cooccurrence.count));

    // Filter to entities not in input
    const candidateEntities = cooccurrences
      .filter(({ entity }) => !inputEntityIds.includes(entity.id))
      .slice(0, 20); // Limit for performance

    const differentiators: Differentiator[] = [];

    for (const { cooc, entity } of candidateEntities) {
      // Skip if already in input
      if (inputEntityIds.includes(entity.id)) continue;

      // Get outcome edges WITH this entity
      const withEntityOutcomes = await this.getOutcomeEdgesForEntity(entity.id);

      // Compare to base outcomes (without this entity explicitly)
      // Use the entity's outcome edge pattern vs average
      const outcomeShift = this.computeOutcomeShift(withEntityOutcomes);

      if (Math.abs(outcomeShift.magnitude) > 0.1) {
        differentiators.push({
          entity: {
            id: entity.id,
            name: entity.name,
            entityType: entity.entityType,
            touchCount: entity.touchCount,
            trajectoryCount: entity.trajectoryCount,
            contributorCount: entity.contributorCount,
          },
          role: entity.entityType as 'context' | 'constraint' | 'strategy',
          effect: outcomeShift.effect,
          magnitude: outcomeShift.magnitude,
          cooccurrenceStrength: cooc.count,
          outcomeShift: outcomeShift.details,
        });
      }
    }

    // Sort by magnitude
    differentiators.sort((a, b) => b.magnitude - a.magnitude);

    return differentiators.slice(0, 5);
  }

  /**
   * Get outcome edges for a single entity.
   */
  private async getOutcomeEdgesForEntity(
    entityId: string
  ): Promise<Array<{
    outcomeId: string;
    outcomeName: string;
    weight: number;
    positiveCount: number;
    negativeCount: number;
  }>> {
    const edges = await this.db
      .select({
        edge: schema.edge,
        outcome: schema.entity,
      })
      .from(schema.edge)
      .innerJoin(
        schema.entity,
        eq(schema.edge.targetEntityId, schema.entity.id)
      )
      .where(
        and(
          eq(schema.edge.sourceEntityId, entityId),
          eq(schema.entity.entityType, 'outcome')
        )
      );

    return edges.map(({ edge, outcome }) => ({
      outcomeId: outcome.id,
      outcomeName: outcome.name,
      weight: edge.weight,
      positiveCount: edge.positiveOutcomes,
      negativeCount: edge.negativeOutcomes,
    }));
  }

  /**
   * Compute how an entity shifts outcomes.
   */
  private computeOutcomeShift(
    outcomeEdges: Array<{
      weight: number;
      positiveCount: number;
      negativeCount: number;
    }>
  ): {
    effect: 'improves' | 'reduces' | 'mixed';
    magnitude: number;
    details: {
      withEntity: { positiveRate: number; totalWeight: number };
      withoutEntity: { positiveRate: number; totalWeight: number };
    };
  } {
    const totalWeight = outcomeEdges.reduce((sum, e) => sum + e.weight, 0);
    const totalPositive = outcomeEdges.reduce((sum, e) => sum + e.positiveCount, 0);
    const totalNegative = outcomeEdges.reduce((sum, e) => sum + e.negativeCount, 0);
    const totalOutcomes = totalPositive + totalNegative;

    const positiveRate = totalOutcomes > 0 ? totalPositive / totalOutcomes : 0.5;

    // Compare to baseline (assume 50% without specific entity)
    // In a richer implementation, we'd compute actual baseline from all entities
    const baselineRate = 0.5;
    const magnitude = Math.abs(positiveRate - baselineRate);

    let effect: 'improves' | 'reduces' | 'mixed';
    if (positiveRate > baselineRate + 0.1) {
      effect = 'improves';
    } else if (positiveRate < baselineRate - 0.1) {
      effect = 'reduces';
    } else {
      effect = 'mixed';
    }

    return {
      effect,
      magnitude,
      details: {
        withEntity: { positiveRate, totalWeight },
        withoutEntity: { positiveRate: baselineRate, totalWeight: 0 },
      },
    };
  }

  // ===========================================================================
  // COUNTERFACTUAL COMPARISON
  // ===========================================================================

  private compareOutcomes(
    original: SimulationResult,
    alternative: SimulationResult,
    change: { from: EntityInput; to: EntityInput }
  ): CounterfactualResult['comparison'] {
    // Collect all outcomes from both simulations
    const allOutcomes = new Set([
      ...original.outcomes.map(o => o.outcome),
      ...alternative.outcomes.map(o => o.outcome),
    ]);

    const outcomeShifts = [...allOutcomes].map(outcome => {
      const origProb = original.outcomes.find(o => o.outcome === outcome)?.probability ?? 0;
      const altProb = alternative.outcomes.find(o => o.outcome === outcome)?.probability ?? 0;

      return {
        outcome,
        originalProbability: origProb,
        alternativeProbability: altProb,
        delta: altProb - origProb,
      };
    }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    // Determine net effect
    const positiveOutcomes = ['improved', 'success', 'understanding', 'mastery', 'effective'];
    const positiveShift = outcomeShifts
      .filter(s => positiveOutcomes.some(p => s.outcome.toLowerCase().includes(p)))
      .reduce((sum, s) => sum + s.delta, 0);

    let netEffect: 'positive' | 'negative' | 'neutral' | 'uncertain';
    if (Math.abs(positiveShift) < 0.05) {
      netEffect = 'neutral';
    } else if (positiveShift > 0) {
      netEffect = 'positive';
    } else {
      netEffect = 'negative';
    }

    // Check evidence
    const minEvidence = Math.min(original.evidence.totalObservations, alternative.evidence.totalObservations);
    if (minEvidence < 5) {
      netEffect = 'uncertain';
    }

    // Generate recommendation
    let recommendation: string;
    if (netEffect === 'uncertain') {
      recommendation = `Insufficient documented patterns to compare "${change.from.name}" vs "${change.to.name}".`;
    } else if (netEffect === 'positive') {
      const bestShift = outcomeShifts.find(s => s.delta > 0);
      recommendation = `"${change.to.name}" shows improved outcomes (+${Math.round((bestShift?.delta ?? 0) * 100)}% for ${bestShift?.outcome}).`;
    } else if (netEffect === 'negative') {
      const worstShift = outcomeShifts.find(s => s.delta < 0);
      recommendation = `"${change.from.name}" appears more effective. "${change.to.name}" shows -${Math.round(Math.abs(worstShift?.delta ?? 0) * 100)}% for ${worstShift?.outcome}.`;
    } else {
      recommendation = `No significant difference between "${change.from.name}" and "${change.to.name}" in accumulated evidence.`;
    }

    return { outcomeShifts, netEffect, recommendation };
  }

  // ===========================================================================
  // AI CONTEXT FORMATTING
  // ===========================================================================

  /**
   * Format simulation for AI consumption.
   * Injects into system prompt for informed responses.
   */
  formatForAI(result: SimulationResult): string {
    if (result.input.resolved.length === 0) {
      const msg = result.input.unresolved.length > 0
        ? `These concepts aren't in the knowledge base yet: ${result.input.unresolved.join(', ')}. Your experience will help build this.`
        : 'No concepts to analyze.';
      return `[PCK Knowledge Base]\n${msg}`;
    }

    let out = `[PCK Knowledge Base]\n\n`;

    // What we're analyzing
    out += `Situation involves:\n`;
    for (const e of result.input.resolved) {
      out += `• ${e.entityType || 'concept'}: "${e.name}"\n`;
    }

    // Outcome patterns (if any)
    if (result.outcomes.length > 0) {
      out += `\nObserved outcomes from similar situations:\n`;
      for (const o of result.outcomes.slice(0, 4)) {
        const pct = Math.round(o.probability * 100);
        out += `• ${o.outcome}: ${pct}% (${o.evidence.edgeWeight} observations, ${o.evidence.positiveCount} positive, ${o.evidence.negativeCount} negative)\n`;
      }
    } else {
      out += `\nNo documented outcome patterns yet for this combination.\n`;
    }

    // Differentiating factors (if any)
    if (result.differentiators.length > 0) {
      out += `\nFactors that may influence outcomes:\n`;
      for (const d of result.differentiators.slice(0, 3)) {
        const dir = d.effect === 'improves' ? 'often improves' : d.effect === 'reduces' ? 'often reduces' : 'has mixed effects on';
        out += `• "${d.entity.name}" (${d.role}) ${dir} outcomes\n`;
      }
    }

    // Simple guidance
    if (!result.evidence.hasPatterns) {
      out += `\nThis is a less documented situation - share what you know to help build the knowledge base.\n`;
    }

    return out;
  }

  /**
   * Format counterfactual for AI consumption.
   */
  formatCounterfactualForAI(result: CounterfactualResult): string {
    let out = `[PCK Knowledge Base - Comparison]\n`;
    out += `Comparing: "${result.change.from.name}" vs "${result.change.to.name}"\n\n`;

    if (result.comparison.outcomeShifts.length > 0) {
      out += `Outcome differences:\n`;
      for (const s of result.comparison.outcomeShifts.slice(0, 3)) {
        if (Math.abs(s.delta) > 0.05) {
          const direction = s.delta > 0 ? 'more' : 'less';
          out += `• ${s.outcome}: ${Math.round(Math.abs(s.delta) * 100)}% ${direction} likely with "${result.change.to.name}"\n`;
        }
      }

      if (result.comparison.outcomeShifts.every(s => Math.abs(s.delta) <= 0.05)) {
        out += `No significant difference observed in documented outcomes.\n`;
      }
    } else {
      out += `Not enough documented patterns to compare these approaches.\n`;
    }

    return out;
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private emptyResult(inputs: EntityInput[], unresolved: string[]): SimulationResult {
    return {
      input: { resolved: [], unresolved },
      outcomes: [],
      differentiators: [],
      evidence: {
        totalObservations: 0,
        outcomeCount: 0,
        hasPatterns: false,
      },
    };
  }
}
