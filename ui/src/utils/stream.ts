/**
 * SSE streaming utilities for consuming chat stream
 */

export interface StreamEvent {
  id: string;
  type: 'chunk' | 'trajectory_event' | 'complete' | 'error';
  data: unknown;
}

export interface ChunkData {
  content: string;
  fullContent: string;
}

export interface TrajectoryEventData {
  trajectoryId?: string;
  conversationId?: string;
  eventType: 'trajectory_start' | 'touch' | 'reason' | 'discover' | 'decide' | 'simulate';
  entityId?: string;
  name?: string;
  entityType?: string;
  source?: string;
  action?: string;
  // Simulation-specific fields
  outcomeCount?: number;
  differentiatorCount?: number;
  resolvedCount?: number;
  unresolvedCount?: number;
  hasPatterns?: boolean;
  // Decision event fields
  entitiesReferenced?: number;
  newEntities?: number;
  simulationUsed?: boolean;
}

export interface CompleteData {
  conversationId: string;
  messageId: string;
  trajectoryId: string;
  simulationUsed?: boolean;
  trajectory: {
    entitiesDiscovered: Array<{ id: string; name: string; entityType?: string }>;
    entitiesTouched: Array<{ id: string; name: string; entityType?: string }>;
    edgesTraversed: Array<{ id: string; sourceEntityId: string; targetEntityId: string }>;
  };
}

export interface ErrorData {
  message: string;
  error?: string;
}

/**
 * Stream chat messages from the API
 * Yields parsed SSE events
 */
export async function* streamChat(
  message: string,
  conversationId?: string,
  options?: {
    lastEventId?: string;
    signal?: AbortSignal;
  }
): AsyncGenerator<StreamEvent> {
  const body = {
    message,
    conversationId,
    lastEventId: options?.lastEventId,
  };

  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    credentials: 'include',
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!response.ok) {
    throw new Error(`Stream failed: ${response.status} ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      let currentEvent: Partial<StreamEvent> = {};

      for (const line of lines) {
        if (line.startsWith('id:')) {
          currentEvent.id = line.slice(3).trim();
        } else if (line.startsWith('event:')) {
          // oRPC uses 'message' event type, data contains our event
          const eventType = line.slice(6).trim();
          if (eventType && eventType !== 'message') {
            currentEvent.type = eventType as StreamEvent['type'];
          }
        } else if (line.startsWith('data:')) {
          const dataStr = line.slice(5).trim();
          if (dataStr) {
            try {
              const parsed = JSON.parse(dataStr);
              // oRPC wraps the event in the data field
              if (parsed.type && parsed.id && parsed.data !== undefined) {
                currentEvent = parsed;
              } else {
                currentEvent.data = parsed;
              }
            } catch {
              // Ignore parse errors
            }
          }
        } else if (line === '' && currentEvent.type && currentEvent.id) {
          // Empty line = end of event
          yield currentEvent as StreamEvent;
          currentEvent = {};
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Type guards for event data
 */
export function isChunkData(data: unknown): data is ChunkData {
  return typeof data === 'object' && data !== null && 'content' in data;
}

export function isTrajectoryEventData(data: unknown): data is TrajectoryEventData {
  return typeof data === 'object' && data !== null && 'eventType' in data;
}

export function isCompleteData(data: unknown): data is CompleteData {
  return typeof data === 'object' && data !== null && 'conversationId' in data && 'trajectory' in data;
}

export function isErrorData(data: unknown): data is ErrorData {
  return typeof data === 'object' && data !== null && 'message' in data;
}
