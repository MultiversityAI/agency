/**
 * Agent Service - PCK Assistant
 *
 * Provides AI-powered chat responses that:
 * - Reason FROM accumulated graph structure (world model)
 * - Document teaching decisions as trajectories
 * - Help instructors navigate pedagogical choices
 */

import OpenAI from "openai";
import { nanoid } from "nanoid";
import { eq, desc, sql } from "drizzle-orm";
import type { Database as DrizzleDatabase } from "../db";
import * as schema from "../db/schema";
import { TrajectoryEngine } from "./trajectory";
import { EmbeddingService } from "./embeddings";
import {
  GraphReasoner,
  type SimulationResult,
  type EntityInput,
} from "./graph-reasoner";

// =============================================================================
// TYPES
// =============================================================================

export interface AgentConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ChatResponse {
  conversationId: string;
  message: {
    id: string;
    role: "assistant";
    content: string;
    trajectoryId: string | null;
    createdAt: string;
  };
  trajectory: {
    id: string;
    entitiesDiscovered: Array<{
      id: string;
      name: string;
      entityType: string | null;
      description: string | null;
      touchCount: number;
    }>;
    entitiesTouched: Array<{
      id: string;
      name: string;
      entityType: string | null;
      description: string | null;
      touchCount: number;
    }>;
    edgesTraversed: Array<{
      id: string;
      sourceEntityId: string;
      targetEntityId: string;
      relationshipType: string | null;
      weight: number;
    }>;
  };
}

export interface StreamEvent {
  type: "chunk" | "trajectory_event" | "complete" | "error";
  id: string;
  data: any;
}

interface ExtractedEntity {
  name: string;
  type: string;
}

// =============================================================================
// SYSTEM PROMPT
// =============================================================================

const PCK_ASSISTANT_PROMPT = `You are a PCK (Pedagogical Content Knowledge) assistant helping STEM instructors document and navigate teaching decisions.

Your role:
- Help instructors articulate teaching situations they've encountered
- Surface relevant precedents from the accumulated knowledge base
- Suggest strategies based on evidence from similar situations
- Document new teaching decisions to help future instructors

When discussing teaching concepts, use typed tags in this format:
- [[topic:concept_name]] - Subject matter topics (e.g., [[topic:derivatives]], [[topic:photosynthesis]])
- [[misconception:description]] - Student misconceptions (e.g., [[misconception:confuses velocity with acceleration]])
- [[strategy:name]] - Teaching strategies (e.g., [[strategy:think-pair-share]], [[strategy:worked examples]])
- [[context:description]] - Teaching context (e.g., [[context:large lecture]], [[context:lab section]])
- [[constraint:description]] - Constraints/limitations (e.g., [[constraint:limited time]], [[constraint:no TA support]])
- [[outcome:description]] - Observed outcomes (e.g., [[outcome:improved understanding]], [[outcome:persistent confusion]])

This tagging helps build a shared knowledge base of teaching decisions.

Keep responses focused on practical teaching insights. When simulation results are provided, cite the evidence level and acknowledge uncertainty appropriately.`;

// =============================================================================
// SERVICE
// =============================================================================

export class AgentService {
  private client: OpenAI;
  private trajectoryEngine: TrajectoryEngine;
  private embeddings: EmbeddingService;
  private graphReasoner: GraphReasoner;

  constructor(
    private db: DrizzleDatabase,
    private config: AgentConfig,
    graphReasoner: GraphReasoner
  ) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.trajectoryEngine = new TrajectoryEngine(db);
    this.embeddings = new EmbeddingService(db);
    this.graphReasoner = graphReasoner;
  }

  // ===========================================================================
  // ENTITY EXTRACTION
  // ===========================================================================

  /**
   * Extract typed entities from text.
   * Supports [[type:name]] format for typed entities.
   * Falls back to [[name]] as 'topic' type for untyped tags.
   */
  private extractEntities(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const seen = new Set<string>();

    // Extract [[type:name]] patterns (typed)
    const typedRegex = /\[\[(\w+):([^\]]+)\]\]/g;
    let match;
    while ((match = typedRegex.exec(text)) !== null) {
      const type = match[1]!.toLowerCase().trim();
      const name = match[2]!.trim().toLowerCase();
      const key = `${type}:${name}`;

      if (!seen.has(key)) {
        seen.add(key);
        entities.push({ name, type });
      }
    }

    // Extract [[name]] patterns (untyped, default to 'topic')
    const untypedRegex = /\[\[([^\]:]+)\]\]/g;
    while ((match = untypedRegex.exec(text)) !== null) {
      const name = match[1]!.trim().toLowerCase();
      const key = `topic:${name}`;

      if (!seen.has(key)) {
        seen.add(key);
        entities.push({ name, type: "topic" });
      }
    }

    return entities;
  }

  /**
   * Extract decision context from text.
   * Captures observations, constraints, outcomes, and rationale.
   */
  private extractContextFromMessage(
    text: string
  ): import("./trajectory").DecisionContext {
    const context: import("./trajectory").DecisionContext = {};

    // Extract observations (patterns: "I noticed", "students", "observed")
    const observationPatterns = [
      /(?:I noticed|noticed|observed|seeing|students?)(.*?)(?:\.|$)/gi,
      /(?:they|he|she) (?:seemed|appeared|looked|were)(.*?)(?:\.|$)/gi,
    ];
    const observations: string[] = [];
    for (const pattern of observationPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const obs = match[1]?.trim();
        if (obs && obs.length > 5) {
          observations.push(obs);
        }
      }
    }
    if (observations.length > 0) {
      context.observations = observations;
    }

    // Extract constraints (patterns: "limited", "only", "no", "can't", "without")
    const constraintPatterns = [
      /(?:limited|only|no|without|can't|cannot|don't have)(.*?)(?:\.|$)/gi,
    ];
    const constraints: string[] = [];
    for (const pattern of constraintPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const constraint = match[0]?.trim();
        if (constraint && constraint.length > 5) {
          constraints.push(constraint);
        }
      }
    }
    if (constraints.length > 0) {
      context.constraints = constraints;
    }

    // Extract expected outcomes (patterns: "hope", "want", "trying to", "goal")
    const outcomePatterns = [
      /(?:hope|hoping|want|wanted|trying to|goal is to)(.*?)(?:\.|$)/gi,
      /(?:would like|expect|expecting)(.*?)(?:\.|$)/gi,
    ];
    let expectedOutcome: string | undefined;
    for (const pattern of outcomePatterns) {
      const match = pattern.exec(text);
      if (match) {
        expectedOutcome = match[0]?.trim();
        break;
      }
    }
    if (expectedOutcome) {
      context.expectedOutcome = expectedOutcome;
    }

    // Extract rationale (patterns: "because", "since", "so that", "to help")
    const rationalePatterns = [
      /(?:because|since|so that|to help)(.*?)(?:\.|$)/gi,
    ];
    let rationale: string | undefined;
    for (const pattern of rationalePatterns) {
      const match = pattern.exec(text);
      if (match) {
        rationale = match[0]?.trim();
        break;
      }
    }
    if (rationale) {
      context.rationale = rationale;
    }

    // Extract prior experience (patterns: "last time", "before", "previously", "in the past")
    const priorPatterns = [
      /(?:last time|before|previously|in the past|used to)(.*?)(?:\.|$)/gi,
    ];
    let priorExperience: string | undefined;
    for (const pattern of priorPatterns) {
      const match = pattern.exec(text);
      if (match) {
        priorExperience = match[0]?.trim();
        break;
      }
    }
    if (priorExperience) {
      context.priorExperience = priorExperience;
    }

    // Add trigger if we have any context
    if (Object.keys(context).length > 0) {
      context.trigger = `Teacher inquiry: ${text.slice(0, 100)}${
        text.length > 100 ? "..." : ""
      }`;
    }

    return context;
  }

  // ===========================================================================
  // CORE METHODS
  // ===========================================================================

  /**
   * Process a chat message and return response with trajectory
   */
  async processMessage(
    nearAccountId: string,
    message: string,
    conversationId?: string
  ): Promise<ChatResponse> {
    const now = new Date();

    // 1. Get or create conversation
    const convId =
      conversationId ?? (await this.createConversation(nearAccountId, message));

    // 2. Start trajectory
    const trajectoryId = await this.trajectoryEngine.startTrajectory(
      nearAccountId,
      message,
      convId
    );

    // 3. Save user message
    const userMessageId = nanoid();
    await this.db.insert(schema.message).values({
      id: userMessageId,
      conversationId: convId,
      role: "user",
      content: message,
      trajectoryId: null,
      createdAt: now,
    });

    // 4. Extract decision context from user message
    const messageContext = this.extractContextFromMessage(message);

    // 5. Extract typed entities from user message
    const mentionedEntities = this.extractEntities(message);
    const entitiesTouched: string[] = [];

    for (const entity of mentionedEntities) {
      const entityId = await this.trajectoryEngine.findOrCreateEntity(
        nearAccountId,
        trajectoryId,
        entity.name,
        entity.type
      );
      entitiesTouched.push(entityId);
      await this.trajectoryEngine.logEvent(trajectoryId, {
        type: "touch",
        entityId,
        data: {
          source: "user_input",
          name: entity.name,
          entityType: entity.type,
        },
        context:
          Object.keys(messageContext).length > 0 ? messageContext : undefined,
      });
    }

    // 6. SIMULATE from graph structure (world model inference)
    const simulationInput: EntityInput[] = mentionedEntities.map((e) => ({
      name: e.name,
      type: e.type,
    }));

    let simulation: SimulationResult | null = null;
    let simulationContext = "";

    if (simulationInput.length > 0) {
      simulation = await this.graphReasoner.simulate(simulationInput);
      simulationContext = this.graphReasoner.formatForAI(simulation);
      console.log("[DEBUG] Simulation context:\n", simulationContext);
    }

    // 7. Get conversation history
    const history = await this.getConversationHistory(convId, 10);

    // 8. Build messages for LLM with simulation context
    const systemPromptWithContext = simulationContext
      ? PCK_ASSISTANT_PROMPT + "\n\n" + simulationContext
      : PCK_ASSISTANT_PROMPT;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPromptWithContext },
      ...history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: message },
    ];

    // 9. Log reasoning event with decision context
    await this.trajectoryEngine.logEvent(trajectoryId, {
      type: "reason",
      data: {
        action: "preparing_response",
        context: {
          entitiesTouched: entitiesTouched.length,
          hasSimulation: simulation !== null,
          hasPatterns: simulation?.evidence.hasPatterns ?? false,
          historyLength: history.length,
        },
      },
      context:
        Object.keys(messageContext).length > 0
          ? {
              ...messageContext,
              alternatives: simulation?.outcomes
                .slice(0, 3)
                .map((o) => o.outcome),
            }
          : undefined,
    });

    // 10. Call NEAR AI Cloud
    let responseContent: string;
    try {
      const completion = await this.client.chat.completions.create({
        model: this.config.model,
        messages,
        max_tokens: 1024,
        temperature: 0.7,
      });

      responseContent =
        completion.choices[0]?.message?.content ??
        "I apologize, but I was unable to generate a response.";
    } catch (error) {
      console.error("[Agent] NEAR AI error:", error);
      responseContent =
        "I apologize, but I encountered an error connecting to the AI service. Please try again.";
    }

    // 11. Extract typed entities from response
    const responseEntities = this.extractEntities(responseContent);
    const entitiesDiscovered: string[] = [];

    for (const entity of responseEntities) {
      const entityId = await this.trajectoryEngine.findOrCreateEntity(
        nearAccountId,
        trajectoryId,
        entity.name,
        entity.type
      );

      if (!entitiesTouched.includes(entityId)) {
        entitiesDiscovered.push(entityId);
        await this.trajectoryEngine.logEvent(trajectoryId, {
          type: "discover",
          entityId,
          data: {
            source: "response",
            name: entity.name,
            entityType: entity.type,
          },
        });
      } else {
        await this.trajectoryEngine.logEvent(trajectoryId, {
          type: "touch",
          entityId,
          data: {
            source: "response",
            name: entity.name,
            entityType: entity.type,
          },
        });
      }
    }

    // 12. Log decision event with context
    await this.trajectoryEngine.logEvent(trajectoryId, {
      type: "decide",
      data: {
        action: "generated_response",
        entitiesReferenced: responseEntities.length,
        newEntities: entitiesDiscovered.length,
        simulationUsed: simulation !== null,
      },
      context: {
        trigger: "Response generation",
        rationale: simulation
          ? `Based on ${simulation.evidence.totalObservations} observations from similar situations, ${responseEntities.length} pedagogical entities referenced`
          : `Referenced ${responseEntities.length} pedagogical entities from teaching experience`,
        alternatives: simulation?.outcomes.slice(0, 3).map((o) => o.outcome),
      },
    });

    // 13. Complete trajectory
    const trajectoryResult = await this.trajectoryEngine.completeTrajectory(
      trajectoryId,
      nearAccountId,
      `Response to: ${message.slice(0, 50)}...`
    );

    // 14. Save assistant message
    const assistantMessageId = nanoid();
    await this.db.insert(schema.message).values({
      id: assistantMessageId,
      conversationId: convId,
      role: "assistant",
      content: responseContent,
      trajectoryId,
      createdAt: new Date(),
    });

    // 15. Update conversation title if first message
    if (!conversationId) {
      const title = message.slice(0, 50) + (message.length > 50 ? "..." : "");
      await this.db
        .update(schema.conversation)
        .set({ title, updatedAt: new Date() })
        .where(eq(schema.conversation.id, convId));
    }

    return {
      conversationId: convId,
      message: {
        id: assistantMessageId,
        role: "assistant",
        content: responseContent,
        trajectoryId,
        createdAt: new Date().toISOString(),
      },
      trajectory: {
        id: trajectoryId,
        entitiesDiscovered: trajectoryResult.entitiesDiscovered,
        entitiesTouched: trajectoryResult.entitiesTouched,
        edgesTraversed: trajectoryResult.edgesTraversed,
      },
    };
  }

  /**
   * Process a chat message with streaming response
   */
  async *processMessageStream(
    nearAccountId: string,
    message: string,
    conversationId?: string
  ): AsyncGenerator<StreamEvent> {
    const now = new Date();
    let eventCounter = 0;

    const generateEventId = () => `evt_${Date.now()}_${eventCounter++}`;

    try {
      // 1. Get or create conversation
      const convId =
        conversationId ??
        (await this.createConversation(nearAccountId, message));

      // 2. Start trajectory
      const trajectoryId = await this.trajectoryEngine.startTrajectory(
        nearAccountId,
        message,
        convId
      );

      // Yield trajectory start event
      yield {
        type: "trajectory_event",
        id: generateEventId(),
        data: {
          eventType: "trajectory_start",
          trajectoryId,
          conversationId: convId,
        },
      };

      // 3. Save user message
      const userMessageId = nanoid();
      await this.db.insert(schema.message).values({
        id: userMessageId,
        conversationId: convId,
        role: "user",
        content: message,
        trajectoryId: null,
        createdAt: now,
      });

      // 4. Extract decision context from user message
      const messageContext = this.extractContextFromMessage(message);

      // 5. Extract typed entities from user message
      const mentionedEntities = this.extractEntities(message);
      const entitiesTouched: string[] = [];

      for (const entity of mentionedEntities) {
        const entityId = await this.trajectoryEngine.findOrCreateEntity(
          nearAccountId,
          trajectoryId,
          entity.name,
          entity.type
        );
        entitiesTouched.push(entityId);

        await this.trajectoryEngine.logEvent(trajectoryId, {
          type: "touch",
          entityId,
          data: {
            source: "user_input",
            name: entity.name,
            entityType: entity.type,
          },
          context:
            Object.keys(messageContext).length > 0 ? messageContext : undefined,
        });

        // Yield trajectory event with entity type
        yield {
          type: "trajectory_event",
          id: generateEventId(),
          data: {
            eventType: "touch",
            entityId,
            name: entity.name,
            entityType: entity.type,
            source: "user_input",
          },
        };
      }

      // 6. SIMULATE from graph structure (world model inference)
      const simulationInput: EntityInput[] = mentionedEntities.map((e) => ({
        name: e.name,
        type: e.type,
      }));

      let simulation: SimulationResult | null = null;
      let simulationContext = "";

      if (simulationInput.length > 0) {
        simulation = await this.graphReasoner.simulate(simulationInput);
        simulationContext = this.graphReasoner.formatForAI(simulation);
        console.log(
          "[DEBUG] Simulation context (stream):\n",
          simulationContext
        );

        // Yield simulation event
        yield {
          type: "trajectory_event",
          id: generateEventId(),
          data: {
            eventType: "simulate",
            outcomeCount: simulation.outcomes.length,
            differentiatorCount: simulation.differentiators.length,
            resolvedCount: simulation.input.resolved.length,
            unresolvedCount: simulation.input.unresolved.length,
            hasPatterns: simulation.evidence.hasPatterns,
          },
        };
      }

      // 7. Get conversation history
      const history = await this.getConversationHistory(convId, 10);

      // 8. Build messages for LLM with simulation context
      const systemPromptWithContext = simulationContext
        ? PCK_ASSISTANT_PROMPT + "\n\n" + simulationContext
        : PCK_ASSISTANT_PROMPT;

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPromptWithContext },
        ...history.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user", content: message },
      ];

      // 9. Log reasoning event with decision context
      await this.trajectoryEngine.logEvent(trajectoryId, {
        type: "reason",
        data: {
          action: "preparing_response",
          context: {
            entitiesTouched: entitiesTouched.length,
            hasSimulation: simulation !== null,
            hasPatterns: simulation?.evidence.hasPatterns ?? false,
            historyLength: history.length,
          },
        },
        context:
          Object.keys(messageContext).length > 0
            ? {
                ...messageContext,
                alternatives: simulation?.outcomes
                  .slice(0, 3)
                  .map((o) => o.outcome),
              }
            : undefined,
      });

      yield {
        type: "trajectory_event",
        id: generateEventId(),
        data: {
          eventType: "reason",
          action: "preparing_response",
        },
      };

      // 10. Call NEAR AI Cloud with streaming
      let fullResponse = "";
      const stream = await this.client.chat.completions.create({
        model: this.config.model,
        messages,
        max_tokens: 1024,
        temperature: 0.7,
        stream: true,
      });

      // Stream chunks
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content ?? "";
        if (content) {
          fullResponse += content;
          yield {
            type: "chunk",
            id: generateEventId(),
            data: {
              content,
              fullContent: fullResponse,
            },
          };
        }
      }

      // 10. Extract typed entities from response
      const responseEntities = this.extractEntities(fullResponse);
      const entitiesDiscovered: string[] = [];

      for (const entity of responseEntities) {
        const entityId = await this.trajectoryEngine.findOrCreateEntity(
          nearAccountId,
          trajectoryId,
          entity.name,
          entity.type
        );

        if (!entitiesTouched.includes(entityId)) {
          entitiesDiscovered.push(entityId);
          await this.trajectoryEngine.logEvent(trajectoryId, {
            type: "discover",
            entityId,
            data: {
              source: "response",
              name: entity.name,
              entityType: entity.type,
            },
          });

          yield {
            type: "trajectory_event",
            id: generateEventId(),
            data: {
              eventType: "discover",
              entityId,
              name: entity.name,
              entityType: entity.type,
              source: "response",
            },
          };
        } else {
          await this.trajectoryEngine.logEvent(trajectoryId, {
            type: "touch",
            entityId,
            data: {
              source: "response",
              name: entity.name,
              entityType: entity.type,
            },
          });

          yield {
            type: "trajectory_event",
            id: generateEventId(),
            data: {
              eventType: "touch",
              entityId,
              name: entity.name,
              entityType: entity.type,
              source: "response",
            },
          };
        }
      }

      // 11. Log decision event with context
      await this.trajectoryEngine.logEvent(trajectoryId, {
        type: "decide",
        data: {
          action: "generated_response",
          entitiesReferenced: responseEntities.length,
          newEntities: entitiesDiscovered.length,
          simulationUsed: simulation !== null,
        },
        context: {
          trigger: "Response generation",
          rationale: simulation
            ? `Based on ${simulation.evidence.totalObservations} observations from similar situations, ${responseEntities.length} pedagogical entities referenced`
            : `Referenced ${responseEntities.length} pedagogical entities from teaching experience`,
          alternatives: simulation?.outcomes.slice(0, 3).map((o) => o.outcome),
        },
      });

      yield {
        type: "trajectory_event",
        id: generateEventId(),
        data: {
          eventType: "decide",
          action: "generated_response",
          entitiesReferenced: responseEntities.length,
          newEntities: entitiesDiscovered.length,
          simulationUsed: simulation !== null,
        },
      };

      // 12. Complete trajectory
      const trajectoryResult = await this.trajectoryEngine.completeTrajectory(
        trajectoryId,
        nearAccountId,
        `Response to: ${message.slice(0, 50)}...`
      );

      // 13. Save assistant message
      const assistantMessageId = nanoid();
      await this.db.insert(schema.message).values({
        id: assistantMessageId,
        conversationId: convId,
        role: "assistant",
        content: fullResponse,
        trajectoryId,
        createdAt: new Date(),
      });

      // 14. Update conversation title if first message
      if (!conversationId) {
        const title = message.slice(0, 50) + (message.length > 50 ? "..." : "");
        await this.db
          .update(schema.conversation)
          .set({ title, updatedAt: new Date() })
          .where(eq(schema.conversation.id, convId));
      }

      // Yield completion event
      yield {
        type: "complete",
        id: generateEventId(),
        data: {
          conversationId: convId,
          messageId: assistantMessageId,
          trajectoryId,
          simulationUsed: simulation !== null,
          trajectory: {
            entitiesDiscovered: trajectoryResult.entitiesDiscovered,
            entitiesTouched: trajectoryResult.entitiesTouched,
            edgesTraversed: trajectoryResult.edgesTraversed,
          },
        },
      };
    } catch (error) {
      console.error("[Agent] Stream error:", error);
      yield {
        type: "error",
        id: generateEventId(),
        data: {
          message:
            error instanceof Error ? error.message : "Unknown error occurred",
          error: String(error),
        },
      };
    }
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  /**
   * Create a new conversation
   */
  private async createConversation(
    nearAccountId: string,
    firstMessage: string
  ): Promise<string> {
    const conversationId = nanoid();
    const now = new Date();

    await this.db.insert(schema.conversation).values({
      id: conversationId,
      nearAccountId,
      title: null, // Will be set after first response
      createdAt: now,
      updatedAt: now,
    });

    return conversationId;
  }

  /**
   * Get conversation history (most recent messages)
   */
  private async getConversationHistory(conversationId: string, limit: number) {
    return this.db
      .select({
        role: schema.message.role,
        content: schema.message.content,
        createdAt: schema.message.createdAt,
      })
      .from(schema.message)
      .where(eq(schema.message.conversationId, conversationId))
      .orderBy(desc(schema.message.createdAt))
      .limit(limit)
      .then((messages) => messages.reverse()); // Reverse to get chronological order
  }

  /**
   * List conversations for a user
   */
  async listConversations(nearAccountId: string): Promise<
    Array<{
      id: string;
      title: string | null;
      messageCount: number;
      lastMessageAt: string | null;
    }>
  > {
    const conversations = await this.db
      .select()
      .from(schema.conversation)
      .where(eq(schema.conversation.nearAccountId, nearAccountId))
      .orderBy(desc(schema.conversation.updatedAt));

    const results = [];
    for (const conv of conversations) {
      const [countResult] = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(schema.message)
        .where(eq(schema.message.conversationId, conv.id));

      const [lastMessage] = await this.db
        .select()
        .from(schema.message)
        .where(eq(schema.message.conversationId, conv.id))
        .orderBy(desc(schema.message.createdAt))
        .limit(1);

      results.push({
        id: conv.id,
        title: conv.title,
        messageCount: countResult?.count ?? 0,
        lastMessageAt: lastMessage?.createdAt?.toISOString() ?? null,
      });
    }

    return results;
  }

  /**
   * Get conversation with messages
   */
  async getConversation(conversationId: string): Promise<{
    conversation: {
      id: string;
      title: string | null;
      createdAt: string;
      updatedAt: string;
    };
    messages: Array<{
      id: string;
      role: "user" | "assistant" | "system";
      content: string;
      trajectoryId: string | null;
      createdAt: string;
    }>;
  } | null> {
    const [conversation] = await this.db
      .select()
      .from(schema.conversation)
      .where(eq(schema.conversation.id, conversationId))
      .limit(1);

    if (!conversation) {
      return null;
    }

    const messages = await this.db
      .select()
      .from(schema.message)
      .where(eq(schema.message.conversationId, conversationId))
      .orderBy(schema.message.createdAt);

    return {
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
      },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
        trajectoryId: m.trajectoryId,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }
}
