/**
 * Chat Route - Primary interface for the PCK Assistant with Context Graph
 *
 * Features:
 * - Streaming chat responses with entity tag support
 * - Real-time trajectory events
 * - Context graph visualization
 * - "What if" simulation panel
 * - Example prompts and debug panel for testing
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { apiClient } from "../../../../utils/orpc";
import {
  streamChat,
  isChunkData,
  isTrajectoryEventData,
  isCompleteData,
  isErrorData,
  type TrajectoryEventData,
} from "../../../../utils/stream";
import { ChatMessage } from "../../../../components/chat/ChatMessage";
import { ChatInput } from "../../../../components/chat/ChatInput";
import { GraphPanel } from "../../../../components/graph/GraphPanel";
import { SimulatePanel } from "../../../../components/simulate/SimulatePanel";
import { cn } from "../../../../lib/utils";
import { getEntityTypeColorClasses } from "../../../../utils/entity-tags";

export const Route = createFileRoute("/_layout/_authenticated/chat/")({
  component: ChatPage,
});

const examplePrompts = [
  {
    title: "Teaching fractions with a misconception",
    text: "I'm teaching [[topic:fractions]] and students have [[misconception:adds numerators and denominators separately]]. I tried [[strategy:visual models]] with pizza slices in a [[context:large lecture]] with [[constraint:limited time]]. The [[outcome:mixed results]] - some got it, others still confused.",
  },
  {
    title: "Seeking strategy recommendations",
    text: "What strategies work best for [[topic:fractions]] when students have [[misconception:adds numerators and denominators separately]]?",
  },
  {
    title: "Documenting a successful approach",
    text: "I used [[strategy:concrete manipulatives]] with fraction bars for [[topic:fractions]]. Students had [[misconception:treats fractions as two separate numbers]]. In my [[context:small group]] setting, the [[outcome:improved understanding]] was clear - they could explain why 1/2 + 1/3 isn't 2/5.",
  },
  {
    title: "Context-specific question",
    text: "What works for [[topic:derivatives]] in a [[context:large lecture]] with [[constraint:no TA support]]?",
  },
];

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  trajectoryId: string | null;
  createdAt: string;
  isStreaming?: boolean;
}

interface TrajectoryInfo {
  id: string;
  entitiesDiscovered: Array<{ id: string; name: string; entityType?: string }>;
  entitiesTouched: Array<{ id: string; name: string; entityType?: string }>;
  edgesTraversed: Array<{ id: string; sourceEntityId: string; targetEntityId: string }>;
}

interface LiveTrajectoryEvent {
  eventType: string;
  entityName?: string;
  entityType?: string;
  timestamp: number;
}

function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isGraphOpen, setIsGraphOpen] = useState(false);
  const [isSimulateOpen, setIsSimulateOpen] = useState(false);
  const [latestTrajectory, setLatestTrajectory] = useState<TrajectoryInfo | null>(null);
  const [liveTrajectoryEvents, setLiveTrajectoryEvents] = useState<LiveTrajectoryEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [lastSimulationContext, setLastSimulationContext] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Fetch graph data (always fetch for stats, faster when graph open)
  const graphQuery = useQuery({
    queryKey: ["graph"],
    queryFn: () => apiClient.getGraph({ depth: 2, minWeight: 0 }),
    refetchInterval: isGraphOpen ? 5000 : 10000,
  });

  // Handle streaming message
  const handleSendMessage = useCallback(async (content: string) => {
    // Abort any existing stream
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    // Add user message immediately
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      trajectoryId: null,
      createdAt: new Date().toISOString(),
    };

    // Add placeholder for assistant message
    const assistantMessageId = `assistant-${Date.now()}`;
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      trajectoryId: null,
      createdAt: new Date().toISOString(),
      isStreaming: true,
    };

    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setIsStreaming(true);
    setLiveTrajectoryEvents([]);

    try {
      const stream = streamChat(content, conversationId ?? undefined, {
        lastEventId: lastEventId ?? undefined,
        signal: abortControllerRef.current.signal,
      });

      for await (const event of stream) {
        // Store last event ID for potential resume
        if (event.id) {
          setLastEventId(event.id);
        }

        switch (event.type) {
          case 'chunk':
            if (isChunkData(event.data)) {
              const chunkData = event.data;
              // Append chunk to assistant message
              setMessages(prev => prev.map(msg =>
                msg.id === assistantMessageId
                  ? { ...msg, content: msg.content + chunkData.content }
                  : msg
              ));
            }
            break;

          case 'trajectory_event':
            if (isTrajectoryEventData(event.data)) {
              const trajEvent = event.data as TrajectoryEventData;

              // Add to live events display
              setLiveTrajectoryEvents(prev => [...prev, {
                eventType: trajEvent.eventType,
                entityName: trajEvent.name,
                entityType: trajEvent.entityType,
                timestamp: Date.now(),
              }]);

              // Show toast for discoveries
              if (trajEvent.eventType === 'discover' && trajEvent.name) {
                const entityLabel = trajEvent.entityType
                  ? `${trajEvent.entityType}: ${trajEvent.name}`
                  : trajEvent.name;
                toast.success(`Discovered: ${entityLabel}`, { duration: 2000 });
              }

              // Capture simulation for debug panel
              if (trajEvent.eventType === 'simulate') {
                setLastSimulationContext(
                  `Simulation triggered\n` +
                  `Outcomes: ${trajEvent.outcomeCount ?? 'unknown'}\n` +
                  `Differentiators: ${trajEvent.differentiatorCount ?? 'unknown'}\n` +
                  `Resolved: ${trajEvent.resolvedCount ?? 'unknown'}\n` +
                  `Unresolved: ${trajEvent.unresolvedCount ?? 'unknown'}`
                );
                toast.info('Analyzing patterns...', { duration: 2000 });
              }
            }
            break;

          case 'complete':
            if (isCompleteData(event.data)) {
              const completeData = event.data;

              // Update conversation ID if new
              if (!conversationId) {
                setConversationId(completeData.conversationId);
              }

              // Update message with final data
              setMessages(prev => prev.map(msg =>
                msg.id === assistantMessageId
                  ? {
                      ...msg,
                      id: completeData.messageId,
                      trajectoryId: completeData.trajectoryId,
                      isStreaming: false,
                    }
                  : msg
              ));

              // Store trajectory info
              setLatestTrajectory({
                id: completeData.trajectoryId,
                ...completeData.trajectory,
              });

              // Invalidate graph query to refresh
              queryClient.invalidateQueries({ queryKey: ["graph"] });

              // Summary toast
              const discovered = completeData.trajectory.entitiesDiscovered.length;
              const touched = completeData.trajectory.entitiesTouched.length;

              if (discovered > 0 || touched > 0) {
                toast.success(
                  `Walk complete: ${touched} touched${discovered > 0 ? `, ${discovered} discovered` : ""}`,
                  { duration: 3000 }
                );
              }
            }
            break;

          case 'error':
            if (isErrorData(event.data)) {
              toast.error(event.data.message);
              // Remove streaming message on error
              setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
            }
            break;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User cancelled, remove incomplete message
        setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
      } else {
        console.error("Stream error:", error);
        toast.error(error instanceof Error ? error.message : "Failed to send message");
        setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
      }
    } finally {
      setIsStreaming(false);
      setLiveTrajectoryEvents([]);
      abortControllerRef.current = null;
    }
  }, [conversationId, lastEventId, queryClient]);

  const handleStopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const handleNewConversation = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setMessages([]);
    setConversationId(null);
    setLatestTrajectory(null);
    setLiveTrajectoryEvents([]);
    setLastEventId(null);
    toast.success("Started new conversation");
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] -mx-4 sm:-mx-6">
      {/* Chat Panel */}
      <div
        className={cn(
          "flex flex-col flex-1 min-w-0 transition-all duration-300",
          isGraphOpen && "lg:w-1/2"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-medium">PCK Assistant</h1>
            {conversationId && (
              <span className="text-xs text-muted-foreground font-mono">
                {conversationId.slice(0, 8)}...
              </span>
            )}
            {isStreaming && (
              <span className="flex items-center gap-1.5 text-xs text-primary">
                <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                streaming
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsDebugOpen(!isDebugOpen)}
              className={cn(
                "px-3 py-1.5 text-xs font-mono border transition-all rounded-lg",
                isDebugOpen
                  ? "border-amber-500 bg-amber-500/10 text-amber-500"
                  : "border-border hover:border-amber-500/50 bg-muted/20 hover:bg-muted/40"
              )}
            >
              debug
            </button>
            <button
              onClick={handleNewConversation}
              className="px-3 py-1.5 text-xs font-mono border border-border hover:border-primary/50 bg-muted/20 hover:bg-muted/40 transition-all rounded-lg"
            >
              new chat
            </button>
            {latestTrajectory && latestTrajectory.entitiesTouched.length >= 2 && (
              <button
                onClick={() => setIsSimulateOpen(true)}
                className="px-3 py-1.5 text-xs font-mono border border-border hover:border-amber-500/50 bg-muted/20 hover:bg-amber-500/10 hover:text-amber-500 transition-all rounded-lg"
              >
                what if? →
              </button>
            )}
            <button
              onClick={() => setIsGraphOpen(!isGraphOpen)}
              className={cn(
                "px-3 py-1.5 text-xs font-mono border transition-all rounded-lg",
                isGraphOpen
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:border-primary/50 bg-muted/20 hover:bg-muted/40"
              )}
            >
              {isGraphOpen ? "hide graph" : "show graph"}
            </button>
          </div>
        </div>

        {/* Debug Panel - shows below header when open */}
        {isDebugOpen && (
          <div className="border-b border-border/50 bg-amber-500/5 p-4 max-h-64 overflow-auto">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-medium text-amber-500">DEBUG: Last Simulation Context</h3>
              <button
                onClick={() => setLastSimulationContext(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                clear
              </button>
            </div>
            {lastSimulationContext ? (
              <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground bg-background/50 p-3 rounded border border-border/30">
                {lastSimulationContext}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground">
                No simulation yet. Send a message with entity tags to see what gets injected into the AI prompt.
              </p>
            )}
          </div>
        )}

        {/* Quick stats when graph is closed */}
        {!isGraphOpen && graphQuery.data && (
          <div className="px-4 py-2 border-b border-border/30 bg-muted/10">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>
                <span className="text-foreground font-medium">{graphQuery.data.nodes.length}</span> entities
              </span>
              <span>
                <span className="text-foreground font-medium">{graphQuery.data.edges.length}</span> edges
              </span>
              <button
                onClick={() => setIsGraphOpen(true)}
                className="text-primary hover:underline"
              >
                view graph →
              </button>
            </div>
          </div>
        )}

        {/* Live Trajectory Events Bar */}
        {liveTrajectoryEvents.length > 0 && (
          <div className="px-4 py-2 border-b border-border/30 bg-muted/10 overflow-x-auto">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground font-mono shrink-0">walk:</span>
              <div className="flex items-center gap-1.5 overflow-x-auto">
                {liveTrajectoryEvents.slice(-8).map((evt, i) => (
                  <span
                    key={i}
                    className={cn(
                      "px-2 py-0.5 rounded font-mono shrink-0 transition-all",
                      evt.eventType === 'trajectory_start' && "bg-blue-500/20 text-blue-500",
                      evt.eventType === 'reason' && "bg-amber-500/20 text-amber-500",
                      evt.eventType === 'decide' && "bg-green-500/20 text-green-500",
                      evt.eventType === 'simulate' && "bg-purple-500/20 text-purple-500",
                      (evt.eventType === 'touch' || evt.eventType === 'discover') && (
                        evt.entityType
                          ? getEntityTypeColorClasses(evt.entityType)
                          : "bg-muted text-foreground"
                      ),
                      evt.eventType === 'discover' && "ring-1 ring-current"
                    )}
                  >
                    {evt.eventType === 'simulate'
                      ? 'analyzing...'
                      : evt.entityName || evt.eventType
                    }
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto px-4">
              <h2 className="text-lg font-medium mb-2">PCK Knowledge Base</h2>
              <p className="text-sm text-muted-foreground text-center mb-6">
                Document teaching situations. The graph learns what works, when, and why.
              </p>

              {/* Entity tag guide */}
              <div className="w-full mb-6 p-4 bg-muted/30 rounded-lg border border-border/50">
                <h3 className="text-xs font-medium text-muted-foreground mb-3">TYPED ENTITY TAGS</h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded">topic</span>
                    <span className="text-muted-foreground">[[topic:fractions]]</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded">misconception</span>
                    <span className="text-muted-foreground">[[misconception:...]]</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 bg-green-500/10 text-green-500 border border-green-500/20 rounded">strategy</span>
                    <span className="text-muted-foreground">[[strategy:...]]</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 bg-purple-500/10 text-purple-500 border border-purple-500/20 rounded">context</span>
                    <span className="text-muted-foreground">[[context:...]]</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 bg-red-500/10 text-red-500 border border-red-500/20 rounded">constraint</span>
                    <span className="text-muted-foreground">[[constraint:...]]</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 bg-cyan-500/10 text-cyan-500 border border-cyan-500/20 rounded">outcome</span>
                    <span className="text-muted-foreground">[[outcome:...]]</span>
                  </div>
                </div>
              </div>

              {/* Example prompts */}
              <div className="w-full">
                <h3 className="text-xs font-medium text-muted-foreground mb-3">TRY THESE EXAMPLES</h3>
                <div className="space-y-2">
                  {examplePrompts.map((prompt, i) => (
                    <button
                      key={i}
                      onClick={() => handleSendMessage(prompt.text)}
                      className="w-full text-left p-3 text-sm bg-muted/20 hover:bg-muted/40 border border-border/50 hover:border-primary/30 rounded-lg transition-all"
                    >
                      <div className="font-medium mb-1">{prompt.title}</div>
                      <div className="text-xs text-muted-foreground truncate">{prompt.text}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <ChatMessage
                key={message.id}
                message={message}
                trajectory={
                  message.role === "assistant" &&
                  !message.isStreaming &&
                  index === messages.length - 1
                    ? latestTrajectory
                    : null
                }
                isStreaming={message.isStreaming}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-border/50">
          <ChatInput
            onSend={handleSendMessage}
            onStop={handleStopStreaming}
            disabled={false}
            isStreaming={isStreaming}
            placeholder="Ask about derivatives, integrals, or any concept..."
          />
        </div>
      </div>

      {/* Graph Panel */}
      {isGraphOpen && (
        <div className="hidden lg:block w-1/2 border-l border-border/50">
          <GraphPanel
            nodes={graphQuery.data?.nodes ?? []}
            edges={graphQuery.data?.edges ?? []}
            isLoading={graphQuery.isLoading}
            latestTrajectory={latestTrajectory}
          />
        </div>
      )}

      {/* Simulation Panel */}
      <SimulatePanel
        isOpen={isSimulateOpen}
        onClose={() => setIsSimulateOpen(false)}
      />
    </div>
  );
}
