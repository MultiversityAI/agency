import { oc, eventIterator } from 'every-plugin/orpc';
import { z } from 'every-plugin/zod';

// =============================================================================
// SHARED SCHEMAS
// =============================================================================

const EventSchema = z.object({
  id: z.string(),
  sequenceNum: z.number(),
  timestamp: z.iso.datetime(),
  eventType: z.enum(['touch', 'reason', 'decide', 'discover']),
  entityId: z.string().nullable(),
  data: z.any().nullable(),
});

const EntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  entityType: z.string().nullable(),
  description: z.string().nullable(),
  touchCount: z.number(),
});

const EdgeSchema = z.object({
  id: z.string(),
  sourceEntityId: z.string(),
  targetEntityId: z.string(),
  relationshipType: z.string().nullable(),
  weight: z.number(),
});

const TrajectorySchema = z.object({
  id: z.string(),
  inputText: z.string(),
  summary: z.string().nullable(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});

const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  trajectoryId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

const ConversationSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

// Graph Reasoner Schemas
const EntityInputSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
});

const ResolvedEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  entityType: z.string().nullable(),
  touchCount: z.number(),
  trajectoryCount: z.number(),
  contributorCount: z.number(),
});

const OutcomeProjectionSchema = z.object({
  outcome: z.string(),
  outcomeId: z.string(),
  probability: z.number(),
  evidence: z.object({
    edgeWeight: z.number(),
    positiveCount: z.number(),
    negativeCount: z.number(),
    mixedCount: z.number(),
    contributorCount: z.number(),
  }),
});

const DifferentiatorSchema = z.object({
  entity: ResolvedEntitySchema,
  role: z.enum(['context', 'constraint', 'strategy']),
  effect: z.enum(['improves', 'reduces', 'mixed']),
  magnitude: z.number(),
  cooccurrenceStrength: z.number(),
  outcomeShift: z.object({
    withEntity: z.object({
      positiveRate: z.number(),
      totalWeight: z.number(),
    }),
    withoutEntity: z.object({
      positiveRate: z.number(),
      totalWeight: z.number(),
    }),
  }),
});

const SimulationResultSchema = z.object({
  input: z.object({
    resolved: z.array(ResolvedEntitySchema),
    unresolved: z.array(z.string()),
  }),
  outcomes: z.array(OutcomeProjectionSchema),
  differentiators: z.array(DifferentiatorSchema),
  evidence: z.object({
    totalObservations: z.number(),
    outcomeCount: z.number(),
    hasPatterns: z.boolean(),
  }),
});

// =============================================================================
// CONTRACT
// =============================================================================

export const contract = oc.router({
  // ===========================================================================
  // HEALTH
  // ===========================================================================

  ping: oc
    .route({ method: 'GET', path: '/ping' })
    .output(z.object({
      status: z.literal('ok'),
      timestamp: z.iso.datetime(),
    })),

  protected: oc
    .route({ method: 'GET', path: '/protected' })
    .output(z.object({
      message: z.string(),
      accountId: z.string(),
      timestamp: z.iso.datetime(),
    })),

  // ===========================================================================
  // CHAT - Primary interface for the agent
  // ===========================================================================

  // Send a message and get a response with trajectory
  chat: oc
    .route({ method: 'POST', path: '/chat' })
    .input(z.object({
      message: z.string().min(1),
      conversationId: z.string().optional(),
    }))
    .output(z.object({
      conversationId: z.string(),
      message: MessageSchema,
      trajectory: z.object({
        id: z.string(),
        entitiesDiscovered: z.array(EntitySchema),
        entitiesTouched: z.array(EntitySchema),
        edgesTraversed: z.array(EdgeSchema),
      }),
    })),

  // Streaming chat endpoint
  chatStream: oc
    .route({ method: 'POST', path: '/chat/stream' })
    .input(z.object({
      message: z.string().min(1),
      conversationId: z.string().optional(),
      lastEventId: z.string().optional(), // For resume support
    }))
    .output(eventIterator(z.object({
      type: z.enum(['chunk', 'trajectory_event', 'complete', 'error']),
      id: z.string(), // Event ID for resume
      data: z.any(),
    }))),

  // List all conversations for the user
  listConversations: oc
    .route({ method: 'GET', path: '/conversations' })
    .output(z.array(z.object({
      id: z.string(),
      title: z.string().nullable(),
      messageCount: z.number(),
      lastMessageAt: z.iso.datetime().nullable(),
    }))),

  // Get a specific conversation with messages
  getConversation: oc
    .route({ method: 'GET', path: '/conversations/{id}' })
    .input(z.object({
      id: z.string(),
    }))
    .output(z.object({
      conversation: ConversationSchema,
      messages: z.array(MessageSchema),
    })),

  // ===========================================================================
  // TRAJECTORIES - The event clock
  // ===========================================================================

  // Get trajectory details (the walk)
  getTrajectory: oc
    .route({ method: 'GET', path: '/trajectories/{id}' })
    .input(z.object({
      id: z.string(),
    }))
    .output(z.object({
      trajectory: TrajectorySchema,
      events: z.array(EventSchema),
      entitiesTouched: z.array(EntitySchema),
    })),

  // List recent trajectories
  listTrajectories: oc
    .route({ method: 'GET', path: '/trajectories' })
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      conversationId: z.string().optional(),
    }))
    .output(z.array(TrajectorySchema)),

  // ===========================================================================
  // GRAPH - Emergent structure
  // ===========================================================================

  // Get graph data for visualization
  getGraph: oc
    .route({ method: 'GET', path: '/graph' })
    .input(z.object({
      centerEntityId: z.string().optional(),
      depth: z.number().min(1).max(5).default(2),
      minWeight: z.number().min(0).default(0),
    }))
    .output(z.object({
      nodes: z.array(z.object({
        id: z.string(),
        name: z.string(),
        entityType: z.string().nullable(),
        touchCount: z.number(),
      })),
      edges: z.array(z.object({
        id: z.string(),
        source: z.string(),
        target: z.string(),
        relationshipType: z.string().nullable(),
        weight: z.number(),
      })),
    })),

  // Get entity details
  getEntity: oc
    .route({ method: 'GET', path: '/entities/{id}' })
    .input(z.object({
      id: z.string(),
    }))
    .output(z.object({
      entity: EntitySchema.extend({
        metadata: z.any().nullable(),
        firstSeen: z.iso.datetime(),
        lastSeen: z.iso.datetime(),
      }),
      connectedEntities: z.array(z.object({
        entity: EntitySchema,
        relationship: z.string().nullable(),
        weight: z.number(),
      })),
      recentTrajectories: z.array(TrajectorySchema),
    })),

  // ===========================================================================
  // SIMULATION - "What if" queries over graph structure
  // ===========================================================================

  // Graph Reasoner: Simulate outcomes from graph structure (world model)
  simulate: oc
    .route({ method: 'POST', path: '/simulate' })
    .input(z.object({
      entities: z.array(EntityInputSchema),
    }))
    .output(SimulationResultSchema),

  // Graph Reasoner: Counterfactual analysis ("What if X instead of Y?")
  counterfactual: oc
    .route({ method: 'POST', path: '/counterfactual' })
    .input(z.object({
      baseEntities: z.array(EntityInputSchema),
      change: z.object({
        from: EntityInputSchema,
        to: EntityInputSchema,
      }),
    }))
    .output(z.object({
      original: SimulationResultSchema,
      alternative: SimulationResultSchema,
      change: z.object({
        from: EntityInputSchema,
        to: EntityInputSchema,
      }),
      comparison: z.object({
        outcomeShifts: z.array(z.object({
          outcome: z.string(),
          originalProbability: z.number(),
          alternativeProbability: z.number(),
          delta: z.number(),
        })),
        netEffect: z.enum(['positive', 'negative', 'neutral', 'uncertain']),
        recommendation: z.string(),
      }),
    })),

  // ===========================================================================
  // LEGACY: Key-Value Store
  // ===========================================================================

  getValue: oc
    .route({ method: 'GET', path: '/kv/{key}' })
    .input(z.object({
      key: z.string(),
    }))
    .output(z.object({
      key: z.string(),
      value: z.string(),
      updatedAt: z.iso.datetime(),
    })),

  setValue: oc
    .route({ method: 'POST', path: '/kv/{key}' })
    .input(z.object({
      key: z.string(),
      value: z.string(),
    }))
    .output(z.object({
      key: z.string(),
      value: z.string(),
      created: z.boolean(),
    })),
});

export type ContractType = typeof contract;
