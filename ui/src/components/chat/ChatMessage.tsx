/**
 * ChatMessage Component
 *
 * Displays a single chat message with optional trajectory indicator.
 * Shows entities touched and discovered during the agent's walk.
 * Renders [[type:name]] entity tags with type-specific colors.
 */

import { cn } from "../../lib/utils";
import { renderContentWithEntities, EntityTag } from "../../utils/entity-tags";

interface TrajectoryInfo {
  id: string;
  entitiesDiscovered: Array<{ id: string; name: string; entityType?: string }>;
  entitiesTouched: Array<{ id: string; name: string; entityType?: string }>;
  edgesTraversed: Array<{ id: string; sourceEntityId: string; targetEntityId: string }>;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  trajectoryId: string | null;
  createdAt: string;
  isStreaming?: boolean;
}

interface ChatMessageProps {
  message: Message;
  trajectory?: TrajectoryInfo | null;
  isStreaming?: boolean;
}

export function ChatMessage({ message, trajectory, isStreaming }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-mono",
          isUser ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
        )}
      >
        {isUser ? "you" : "ai"}
      </div>

      {/* Message Content */}
      <div className={cn("flex-1 max-w-[85%]", isUser && "flex flex-col items-end")}>
        <div
          className={cn(
            "rounded-lg px-4 py-3 text-sm",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted/50 border border-border/50"
          )}
        >
          <div className="whitespace-pre-wrap break-words leading-relaxed">
            {isAssistant ? renderContentWithEntities(message.content) : message.content}
            {isStreaming && (
              <span className="inline-block w-2 h-4 ml-1 bg-primary/60 animate-pulse rounded-sm" />
            )}
          </div>
        </div>

        {/* Trajectory Badge */}
        {trajectory && isAssistant && !isStreaming && (
          <TrajectoryBadge trajectory={trajectory} />
        )}

        {/* Timestamp */}
        <div className="mt-1 text-xs text-muted-foreground/50 font-mono">
          {isStreaming ? (
            <span className="text-primary">generating...</span>
          ) : (
            new Date(message.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          )}
        </div>
      </div>
    </div>
  );
}

function TrajectoryBadge({ trajectory }: { trajectory: TrajectoryInfo }) {
  const touchedCount = trajectory.entitiesTouched.length;
  const discoveredCount = trajectory.entitiesDiscovered.length;
  const edgeCount = trajectory.edgesTraversed.length;

  if (touchedCount === 0 && discoveredCount === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {/* Walk indicator */}
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-mono bg-muted/30 rounded border border-border/30">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-3 h-3 text-muted-foreground"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <path d="M2 12h20" />
        </svg>
        <span className="text-muted-foreground">walk:</span>
        <span className="text-foreground">{touchedCount} touched</span>
        {discoveredCount > 0 && (
          <>
            <span className="text-muted-foreground">/</span>
            <span className="text-primary">{discoveredCount} new</span>
          </>
        )}
        {edgeCount > 0 && (
          <>
            <span className="text-muted-foreground">/</span>
            <span className="text-muted-foreground">{edgeCount} edges</span>
          </>
        )}
      </div>

      {/* Entity popover */}
      {(touchedCount > 0 || discoveredCount > 0) && (
        <EntityPopover trajectory={trajectory} />
      )}
    </div>
  );
}

function EntityPopover({ trajectory }: { trajectory: TrajectoryInfo }) {
  return (
    <div className="group relative">
      <button className="px-2 py-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors">
        entities
      </button>
      <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-10">
        <div className="bg-popover border border-border rounded-lg shadow-lg p-2 min-w-[180px] max-w-[300px]">
          {trajectory.entitiesTouched.length > 0 && (
            <div className="mb-2">
              <div className="text-xs text-muted-foreground mb-1">Touched:</div>
              <div className="flex flex-wrap gap-1">
                {trajectory.entitiesTouched.slice(0, 8).map((entity) => (
                  <EntityTag
                    key={entity.id}
                    type={(entity.entityType as any) || 'concept'}
                    name={entity.name}
                  />
                ))}
                {trajectory.entitiesTouched.length > 8 && (
                  <span className="text-xs text-muted-foreground">
                    +{trajectory.entitiesTouched.length - 8}
                  </span>
                )}
              </div>
            </div>
          )}
          {trajectory.entitiesDiscovered.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Discovered:</div>
              <div className="flex flex-wrap gap-1">
                {trajectory.entitiesDiscovered.slice(0, 8).map((entity) => (
                  <EntityTag
                    key={entity.id}
                    type={(entity.entityType as any) || 'concept'}
                    name={entity.name}
                  />
                ))}
                {trajectory.entitiesDiscovered.length > 8 && (
                  <span className="text-xs text-muted-foreground">
                    +{trajectory.entitiesDiscovered.length - 8}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
