/**
 * Services Index
 *
 * Central export for all context graph services.
 */

export { TrajectoryEngine } from './trajectory';
export type { TrajectoryEvent, TrajectoryInfo, EntityInfo, EdgeInfo, EventType } from './trajectory';

export { EmbeddingService } from './embeddings';
export type { SimilarEntity } from './embeddings';

export { AgentService } from './agent';
export type { AgentConfig, ChatResponse } from './agent';

export { GraphService } from './graph';
export type { GraphNode, GraphEdge, GraphData } from './graph';

export { GraphReasoner } from './graph-reasoner';
export type {
  EntityInput,
  ResolvedEntity,
  OutcomeProjection,
  Differentiator,
  SimulationResult as GraphSimulationResult,
  CounterfactualResult,
} from './graph-reasoner';
