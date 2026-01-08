/**
 * SimulatePanel Component
 *
 * "If your context graph can't answer 'what if,' it's just a search index."
 *
 * This panel allows teachers to simulate outcomes from pedagogical strategies
 * using the accumulated PCK graph structure.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { cn } from "../../lib/utils";
import { apiClient } from "../../utils/orpc";

interface ResolvedEntity {
  id: string;
  name: string;
  entityType: string | null;
  touchCount: number;
  trajectoryCount: number;
  contributorCount: number;
}

interface OutcomeProjection {
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

interface Differentiator {
  entity: ResolvedEntity;
  role: 'context' | 'constraint' | 'strategy';
  effect: 'improves' | 'reduces' | 'mixed';
  magnitude: number;
  cooccurrenceStrength: number;
}

interface SimulationResult {
  input: {
    resolved: ResolvedEntity[];
    unresolved: string[];
  };
  outcomes: OutcomeProjection[];
  differentiators: Differentiator[];
  evidence: {
    totalObservations: number;
    outcomeCount: number;
    hasPatterns: boolean;
  };
}

interface SimulatePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SimulatePanel({ isOpen, onClose }: SimulatePanelProps) {
  const [entityInput, setEntityInput] = useState("");
  const [result, setResult] = useState<SimulationResult | null>(null);

  const simulateMutation = useMutation({
    mutationFn: (input: string) => {
      // Parse comma-separated entities
      const entities = input
        .split(',')
        .map(e => e.trim())
        .filter(e => e.length > 0)
        .map(name => ({ name }));
      return apiClient.simulate({ entities });
    },
    onSuccess: (data) => {
      setResult(data);
    },
  });

  const handleSimulate = () => {
    if (entityInput.trim()) {
      simulateMutation.mutate(entityInput.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSimulate();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl mx-4 bg-background border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/50">
          <div>
            <h2 className="text-lg font-medium">What If?</h2>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              Predict trajectories for hypothetical questions
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted/50 rounded-lg transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Entity Input */}
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground font-mono">
              Pedagogical entities (comma-separated)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={entityInput}
                onChange={(e) => setEntityInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="inquiry-based learning, scaffolding, formative assessment"
                disabled={simulateMutation.isPending}
                className={cn(
                  "flex-1 px-4 py-3 rounded-lg border border-border/50 bg-muted/20",
                  "text-sm placeholder:text-muted-foreground/60",
                  "focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20",
                  "disabled:opacity-50"
                )}
              />
              <button
                onClick={handleSimulate}
                disabled={!entityInput.trim() || simulateMutation.isPending}
                className={cn(
                  "px-4 py-3 rounded-lg bg-primary text-primary-foreground",
                  "text-sm font-medium",
                  "hover:bg-primary/90 active:scale-95",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  "transition-all"
                )}
              >
                {simulateMutation.isPending ? "Simulating..." : "Simulate"}
              </button>
            </div>
          </div>

          {/* Error */}
          {simulateMutation.isError && (
            <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              Failed to simulate. Try again.
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-4">
              {/* Evidence Summary */}
              <div className="flex items-center gap-3">
                <div className="text-sm text-muted-foreground font-mono">
                  Evidence:
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className={result.evidence.hasPatterns ? "text-primary" : "text-muted-foreground"}>
                    {result.evidence.totalObservations} observations
                  </span>
                  {result.evidence.outcomeCount > 0 && (
                    <>
                      <span className="text-muted-foreground">•</span>
                      <span className="text-primary">
                        {result.evidence.outcomeCount} outcome patterns
                      </span>
                    </>
                  )}
                  {!result.evidence.hasPatterns && (
                    <>
                      <span className="text-muted-foreground">•</span>
                      <span className="text-muted-foreground">limited data</span>
                    </>
                  )}
                </div>
              </div>

              {/* Outcome Projections */}
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground font-mono">
                  Predicted outcomes:
                </div>
                {result.outcomes.length === 0 ? (
                  <div className="p-4 rounded-lg bg-muted/30 border border-border/30 text-sm text-muted-foreground">
                    No outcome predictions available. Build more context first.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {result.outcomes.map((outcome) => (
                      <div
                        key={outcome.outcomeId}
                        className="p-3 rounded-lg bg-muted/20 border border-border/30"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="text-sm font-medium">{outcome.outcome}</div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Evidence: {outcome.evidence.contributorCount} contributors,
                              {outcome.evidence.positiveCount}+ / {outcome.evidence.negativeCount}- / {outcome.evidence.mixedCount}~
                            </div>
                          </div>
                          <div className="px-2 py-1 text-xs font-mono bg-muted rounded">
                            {Math.round(outcome.probability * 100)}%
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Differentiators */}
              {result.differentiators.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground font-mono">
                    Key differentiators:
                  </div>
                  <div className="space-y-2">
                    {result.differentiators.slice(0, 5).map((diff, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg bg-muted/20 border border-border/30"
                      >
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "px-2 py-1 rounded text-xs font-mono",
                            diff.effect === 'improves' && "bg-green-500/10 text-green-600 border border-green-500/20",
                            diff.effect === 'reduces' && "bg-red-500/10 text-red-600 border border-red-500/20",
                            diff.effect === 'mixed' && "bg-yellow-500/10 text-yellow-600 border border-yellow-500/20"
                          )}>
                            {diff.entity.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {diff.role} • {diff.effect} • {Math.round(diff.magnitude * 100)}% impact
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty State */}
          {!result && !simulateMutation.isPending && (
            <div className="py-8 text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-muted/30 flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-6 h-6 text-muted-foreground/50"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <path d="M12 17h.01" />
                </svg>
              </div>
              <div className="text-sm text-muted-foreground">
                Enter pedagogical strategies to simulate outcomes
              </div>
              <div className="text-xs text-muted-foreground/60 mt-1">
                Based on accumulated PCK graph structure
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
