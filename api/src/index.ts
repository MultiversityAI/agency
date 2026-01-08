import { eq } from 'drizzle-orm';
import { createPlugin } from 'every-plugin';
import { Effect } from 'every-plugin/effect';
import { ORPCError } from 'every-plugin/orpc';
import { z } from 'every-plugin/zod';
import { contract } from './contract';
import { kvStore } from './db/schema';
import { Database, DatabaseLive } from './store';
import {
  TrajectoryEngine,
  EmbeddingService,
  AgentService,
  GraphService,
  GraphReasoner,
} from './services';

export default createPlugin({
  variables: z.object({
    NEAR_AI_MODEL: z.string().default('deepseek-ai/DeepSeek-V3.1'),
  }),

  secrets: z.object({
    API_DATABASE_URL: z.string().default('file:./api.db'),
    API_DATABASE_AUTH_TOKEN: z.string().optional(),
    NEAR_AI_API_KEY: z.string().optional(),
    NEAR_AI_BASE_URL: z.string().default('https://cloud-api.near.ai/v1'),
  }),

  context: z.object({
    nearAccountId: z.string().optional(),
  }),

  contract,

  initialize: (config) =>
    Effect.gen(function* () {
      const dbLayer = DatabaseLive(config.secrets.API_DATABASE_URL, config.secrets.API_DATABASE_AUTH_TOKEN);
      const db = yield* Effect.provide(Database, dbLayer);

      // Initialize services
      const trajectoryEngine = new TrajectoryEngine(db);
      const embeddings = new EmbeddingService(db);
      const graphService = new GraphService(db);
      const graphReasoner = new GraphReasoner(db);

      // Initialize agent service if API key is provided
      let agentService: AgentService | null = null;
      if (config.secrets.NEAR_AI_API_KEY) {
        agentService = new AgentService(
          db,
          {
            apiKey: config.secrets.NEAR_AI_API_KEY,
            baseUrl: config.secrets.NEAR_AI_BASE_URL,
            model: config.variables.NEAR_AI_MODEL,
          },
          graphReasoner  // Pass graphReasoner as third argument
        );
        console.log('[API] Agent service initialized with NEAR AI + GraphReasoner');
      } else {
        console.log('[API] NEAR_AI_API_KEY not provided - chat will return mock responses');
      }

      console.log('[API] Plugin initialized');

      return {
        db,
        trajectoryEngine,
        embeddings,
        graphService,
        graphReasoner,
        agentService,
      };
    }),

  shutdown: (_context) =>
    Effect.gen(function* () {
      yield* Effect.promise(async () => console.log('[API] Plugin shutdown'));
    }),

  createRouter: (context, builder) => {
    const { db, trajectoryEngine, embeddings, graphService, graphReasoner, agentService } = context;

    const requireAuth = builder.middleware(async ({ context, next }) => {
      if (!context.nearAccountId) {
        throw new ORPCError('UNAUTHORIZED', {
          message: 'Authentication required',
          data: { authType: 'nearAccountId' }
        });
      }
      return next({
        context: {
          nearAccountId: context.nearAccountId,
        }
      });
    });

    return {
      // ===========================================================================
      // HEALTH
      // ===========================================================================

      ping: builder.ping.handler(async () => {
        return {
          status: 'ok' as const,
          timestamp: new Date().toISOString(),
        };
      }),

      protected: builder.protected
        .use(requireAuth)
        .handler(async ({ context }) => {
          return {
            message: 'This is a protected endpoint',
            accountId: context.nearAccountId,
            timestamp: new Date().toISOString(),
          };
        }),

      // ===========================================================================
      // CHAT
      // ===========================================================================

      chat: builder.chat
        .use(requireAuth)
        .handler(async ({ input, context }) => {
          if (!agentService) {
            // Return mock response if no API key
            const mockResponse = {
              conversationId: 'mock-conv-' + Date.now(),
              message: {
                id: 'mock-msg-' + Date.now(),
                role: 'assistant' as const,
                content: `[Mock Response] You asked: "${input.message}". Configure NEAR_AI_API_KEY to enable real AI responses.`,
                trajectoryId: null,
                createdAt: new Date().toISOString(),
              },
              trajectory: {
                id: 'mock-trajectory',
                entitiesDiscovered: [],
                entitiesTouched: [],
                edgesTraversed: [],
              },
            };
            return mockResponse;
          }

          return agentService.processMessage(
            context.nearAccountId,
            input.message,
            input.conversationId
          );
        }),

      chatStream: builder.chatStream
        .use(requireAuth)
        .handler(async function* ({ input, context, signal }) {
          if (!agentService) {
            // Mock streaming response if no API key
            yield {
              type: 'error' as const,
              id: 'mock-error-' + Date.now(),
              data: {
                message: 'NEAR_AI_API_KEY not configured. Please configure to enable AI responses.',
              },
            };
            return;
          }

          // Use the streaming method from agent service
          for await (const event of agentService.processMessageStream(
            context.nearAccountId,
            input.message,
            input.conversationId
          )) {
            // Check if client has disconnected
            if (signal?.aborted) {
              console.log('[API] Client disconnected, stopping stream');
              break;
            }

            yield event;
          }
        }),

      listConversations: builder.listConversations
        .use(requireAuth)
        .handler(async ({ context }) => {
          if (!agentService) {
            return [];
          }
          return agentService.listConversations(context.nearAccountId);
        }),

      getConversation: builder.getConversation
        .use(requireAuth)
        .handler(async ({ input }) => {
          if (!agentService) {
            throw new ORPCError('NOT_FOUND', { message: 'Conversation not found' });
          }
          const result = await agentService.getConversation(input.id);
          if (!result) {
            throw new ORPCError('NOT_FOUND', { message: 'Conversation not found' });
          }
          return result;
        }),

      // ===========================================================================
      // TRAJECTORIES
      // ===========================================================================

      getTrajectory: builder.getTrajectory
        .use(requireAuth)
        .handler(async ({ input }) => {
          const result = await trajectoryEngine.getTrajectory(input.id);
          if (!result) {
            throw new ORPCError('NOT_FOUND', { message: 'Trajectory not found' });
          }
          return {
            trajectory: {
              id: result.trajectory.id,
              inputText: result.trajectory.inputText,
              summary: result.trajectory.summary,
              startedAt: result.trajectory.startedAt.toISOString(),
              completedAt: result.trajectory.completedAt?.toISOString() ?? null,
            },
            events: result.events.map(e => ({
              id: e.id,
              sequenceNum: e.sequenceNum,
              timestamp: e.timestamp.toISOString(),
              eventType: e.eventType,
              entityId: e.entityId,
              data: e.data,
            })),
            entitiesTouched: result.entitiesTouched,
          };
        }),

      listTrajectories: builder.listTrajectories
        .use(requireAuth)
        .handler(async ({ input, context }) => {
          const trajectories = await trajectoryEngine.listTrajectories(
            context.nearAccountId,
            input.limit,
            input.conversationId
          );
          return trajectories.map(t => ({
            id: t.id,
            inputText: t.inputText,
            summary: t.summary,
            startedAt: t.startedAt.toISOString(),
            completedAt: t.completedAt?.toISOString() ?? null,
          }));
        }),

      // ===========================================================================
      // GRAPH
      // ===========================================================================

      getGraph: builder.getGraph
        .use(requireAuth)
        .handler(async ({ input, context }) => {
          const graph = await graphService.getGraph(context.nearAccountId, {
            centerEntityId: input.centerEntityId,
            depth: input.depth,
            minWeight: input.minWeight,
          });
          return {
            nodes: graph.nodes,
            edges: graph.edges.map(e => ({
              id: e.id,
              source: e.source,
              target: e.target,
              relationshipType: e.relationshipType,
              weight: e.weight,
            })),
          };
        }),

      getEntity: builder.getEntity
        .use(requireAuth)
        .handler(async ({ input, context }) => {
          const result = await graphService.getEntity(context.nearAccountId, input.id);
          if (!result) {
            throw new ORPCError('NOT_FOUND', { message: 'Entity not found' });
          }
          return result;
        }),

      // ===========================================================================
      // SIMULATION - Graph Reasoner (world model inference)
      // ===========================================================================

      simulate: builder.simulate
        .use(requireAuth)
        .handler(async ({ input }) => {
          return graphReasoner.simulate(input.entities);
        }),

      counterfactual: builder.counterfactual
        .use(requireAuth)
        .handler(async ({ input }) => {
          return graphReasoner.counterfactual(input.baseEntities, input.change);
        }),

      // ===========================================================================
      // LEGACY: Key-Value Store
      // ===========================================================================

      getValue: builder.getValue
        .use(requireAuth)
        .handler(async ({ input, context }) => {
          const [record] = await db
            .select()
            .from(kvStore)
            .where(eq(kvStore.key, input.key))
            .limit(1);

          if (!record) {
            throw new ORPCError('NOT_FOUND', {
              message: 'Key not found',
            });
          }

          if (record.nearAccountId !== context.nearAccountId) {
            throw new ORPCError('FORBIDDEN', {
              message: 'Access denied',
            });
          }

          return {
            key: record.key,
            value: record.value,
            updatedAt: record.updatedAt.toISOString(),
          };
        }),

      setValue: builder.setValue
        .use(requireAuth)
        .handler(async ({ input, context }) => {
          const now = new Date();

          const [existing] = await db
            .select()
            .from(kvStore)
            .where(eq(kvStore.key, input.key))
            .limit(1);

          let created = false;

          if (existing) {
            if (existing.nearAccountId !== context.nearAccountId) {
              throw new ORPCError('FORBIDDEN', {
                message: 'Access denied',
              });
            }

            await db
              .update(kvStore)
              .set({
                value: input.value,
                updatedAt: now,
              })
              .where(eq(kvStore.key, input.key));
          } else {
            await db.insert(kvStore).values({
              key: input.key,
              value: input.value,
              nearAccountId: context.nearAccountId,
              createdAt: now,
              updatedAt: now,
            });
            created = true;
          }

          return {
            key: input.key,
            value: input.value,
            created,
          };
        }),
    }
  },
});
