/**
 * GraphPanel Component
 *
 * Displays the context graph using React Flow.
 * Shows entities as nodes and edges as connections.
 * Highlights recently traversed paths from the latest trajectory.
 */

import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node as ReactFlowNode,
  type Edge as ReactFlowEdge,
} from "reactflow";
import "reactflow/dist/style.css";

interface GraphNode {
  id: string;
  name: string;
  entityType: string | null;
  touchCount: number;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relationshipType: string | null;
  weight: number;
}

interface TrajectoryInfo {
  id: string;
  entitiesDiscovered: Array<{ id: string; name: string }>;
  entitiesTouched: Array<{ id: string; name: string }>;
  edgesTraversed: Array<{ id: string; sourceEntityId: string; targetEntityId: string }>;
}

interface GraphPanelProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  isLoading?: boolean;
  latestTrajectory?: TrajectoryInfo | null;
}

// Color palette for entity types
const typeColors: Record<string, string> = {
  concept: "#3b82f6", // blue
  topic: "#8b5cf6", // violet
  example: "#10b981", // emerald
  definition: "#f59e0b", // amber
  default: "#6b7280", // gray
};

export function GraphPanel({
  nodes,
  edges,
  isLoading = false,
  latestTrajectory,
}: GraphPanelProps) {
  // Track touched entities from latest trajectory
  const touchedEntityIds = useMemo(() => {
    if (!latestTrajectory) return new Set<string>();
    return new Set([
      ...latestTrajectory.entitiesTouched.map((e) => e.id),
      ...latestTrajectory.entitiesDiscovered.map((e) => e.id),
    ]);
  }, [latestTrajectory]);

  const discoveredEntityIds = useMemo(() => {
    if (!latestTrajectory) return new Set<string>();
    return new Set(latestTrajectory.entitiesDiscovered.map((e) => e.id));
  }, [latestTrajectory]);

  // Convert graph data to React Flow format
  const flowNodes: ReactFlowNode[] = useMemo(() => {
    // Simple force-directed-ish layout
    const angleStep = (2 * Math.PI) / Math.max(nodes.length, 1);
    const radius = 200;

    return nodes.map((node, index) => {
      const angle = angleStep * index;
      const isTouched = touchedEntityIds.has(node.id);
      const isDiscovered = discoveredEntityIds.has(node.id);
      const color = typeColors[node.entityType ?? "default"] ?? typeColors.default;

      return {
        id: node.id,
        position: {
          x: 300 + Math.cos(angle) * radius * (1 + node.touchCount * 0.1),
          y: 300 + Math.sin(angle) * radius * (1 + node.touchCount * 0.1),
        },
        data: {
          label: node.name,
          touchCount: node.touchCount,
          entityType: node.entityType,
        },
        style: {
          background: isDiscovered
            ? `${color}30`
            : isTouched
              ? `${color}20`
              : `${color}10`,
          border: `2px solid ${isDiscovered ? color : isTouched ? `${color}80` : `${color}40`}`,
          borderRadius: "8px",
          padding: "8px 12px",
          fontSize: "12px",
          fontFamily: "monospace",
          color: isTouched ? color : `${color}cc`,
          boxShadow: isDiscovered
            ? `0 0 12px ${color}40`
            : isTouched
              ? `0 0 8px ${color}20`
              : "none",
          transition: "all 0.3s ease",
        },
      };
    });
  }, [nodes, touchedEntityIds, discoveredEntityIds]);

  const flowEdges: ReactFlowEdge[] = useMemo(() => {
    const traversedEdgeIds = new Set(
      latestTrajectory?.edgesTraversed.map((e) => e.id) ?? []
    );

    return edges.map((edge) => {
      const isTraversed = traversedEdgeIds.has(edge.id);

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.relationshipType ?? undefined,
        animated: isTraversed,
        style: {
          stroke: isTraversed ? "#3b82f6" : "#6b728050",
          strokeWidth: Math.min(1 + edge.weight * 0.5, 4),
        },
        labelStyle: {
          fontSize: "10px",
          fontFamily: "monospace",
          fill: "#6b7280",
        },
      };
    });
  }, [edges, latestTrajectory]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-muted/10">
        <div className="text-sm text-muted-foreground font-mono animate-pulse">
          Loading graph...
        </div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-muted/10 p-4">
        <div className="w-16 h-16 mb-4 rounded-full bg-muted/30 flex items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-8 h-8 text-muted-foreground/50"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
            <path d="M2 12h20" />
          </svg>
        </div>
        <div className="text-sm text-muted-foreground font-mono text-center">
          No entities yet
        </div>
        <div className="text-xs text-muted-foreground/60 font-mono text-center mt-1">
          Start chatting to build the graph
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Context Graph</h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
            <span>{nodes.length} nodes</span>
            <span className="text-muted-foreground/30">|</span>
            <span>{edges.length} edges</span>
          </div>
        </div>
      </div>

      {/* Graph */}
      <div className="flex-1">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={2}
          nodesDraggable={true}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#6b728020" gap={20} />
          <Controls
            showZoom={true}
            showFitView={true}
            showInteractive={false}
            className="!bg-background/80 !border-border/50"
          />
          <MiniMap
            nodeColor={(node) => {
              const type = node.data?.entityType ?? "default";
              return typeColors[type] ?? typeColors.default;
            }}
            maskColor="rgba(0, 0, 0, 0.8)"
            className="!bg-background/80 !border-border/50"
          />
        </ReactFlow>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-t border-border/50">
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded border-2 border-blue-500 bg-blue-500/20" />
            <span className="text-muted-foreground font-mono">touched</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded border-2 border-blue-500 bg-blue-500/30 shadow-[0_0_8px_rgba(59,130,246,0.4)]" />
            <span className="text-muted-foreground font-mono">discovered</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-0.5 bg-blue-500" />
            <span className="text-muted-foreground font-mono">traversed</span>
          </div>
        </div>
      </div>
    </div>
  );
}
