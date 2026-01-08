import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "../../../lib/auth-client";
import { apiClient } from "../../../utils/orpc";

export type ProtectedResult = Awaited<ReturnType<typeof apiClient.protected>>;
export type SetValueResult = Awaited<ReturnType<typeof apiClient.setValue>>;
export type GetValueResult = Awaited<ReturnType<typeof apiClient.getValue>>;

export const Route = createFileRoute("/_layout/_authenticated/")({
  component: Dashboard,
});

function Dashboard() {
  const [kvKey, setKvKey] = useState("mykey");
  const [kvValue, setKvValue] = useState("myvalue");
  const [protectedData, setProtectedData] = useState<ProtectedResult | null>(null);
  const [kvResult, setKvResult] = useState<SetValueResult | GetValueResult | null>(null);

  const accountId = authClient.near.getAccountId();

  const protectedMutation = useMutation({
    mutationFn: () => apiClient.protected(),
    onSuccess: (data) => {
      setProtectedData(data);
      toast.success("Protected endpoint called");
    },
    onError: (error) => {
      console.error("Error calling protected:", error);
      toast.error(error.message || "Failed to call protected endpoint");
    },
  });

  const setValueMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      apiClient.setValue({ key, value }),
    onSuccess: (data) => {
      setKvResult(data);
      toast.success(`Key "${kvKey}" ${data?.created ? "created" : "updated"}`);
    },
    onError: (error) => {
      console.error("Error setting value:", error);
      toast.error(error.message || "Failed to set value");
    },
  });

  const getValueMutation = useMutation({
    mutationFn: ({ key }: { key: string }) => apiClient.getValue({ key }),
    onSuccess: (data) => {
      setKvResult(data);
      toast.success(`Retrieved value for "${kvKey}"`);
    },
    onError: (error) => {
      console.error("Error getting value:", error);
      toast.error(error.message || "Failed to get value");
      setKvResult(null);
    },
  });

  const isLoading =
    protectedMutation.isPending ||
    setValueMutation.isPending ||
    getValueMutation.isPending;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between pb-4 border-b border-border/50">
        <span className="text-xs text-muted-foreground font-mono">
          {accountId}
        </span>
        <Link
          to="/dashboard"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors font-mono"
        >
          admin
        </Link>
      </div>

      {/* Chat Agent Card */}
      <Link
        to="/chat"
        className="block p-6 rounded-xl border border-border/50 bg-gradient-to-br from-primary/5 to-primary/10 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all group"
      >
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <h2 className="text-lg font-medium group-hover:text-primary transition-colors">
              Teacher Assistant
            </h2>
            <p className="text-sm text-muted-foreground">
              Chat with an AI that builds a context graph as you learn
            </p>
            <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground font-mono">
              <span className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                trajectory capture
              </span>
              <span className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                graph visualization
              </span>
              <span className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-amber-500" />
                what-if simulation
              </span>
            </div>
          </div>
          <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-6 h-6 text-primary"
            >
              <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
            </svg>
          </div>
        </div>
      </Link>

      <div className="space-y-6">
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => protectedMutation.mutate()}
              disabled={isLoading}
              className="w-full px-5 py-3 text-sm font-mono border border-border hover:border-primary/50 bg-muted/20 hover:bg-muted/40 transition-all rounded-lg disabled:opacity-50 disabled:cursor-not-allowed text-left"
            >
              {protectedMutation.isPending
                ? "calling..."
                : "call protected endpoint"}
            </button>

            {protectedData && (
              <div className="p-4 bg-muted/20 rounded-lg border border-border/50">
                <pre className="text-xs font-mono text-muted-foreground overflow-auto">
                  {JSON.stringify(protectedData, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <div className="space-y-3 pt-4 border-t border-border/50">
            <input
              type="text"
              value={kvKey}
              onChange={(e) => setKvKey(e.target.value)}
              className="w-full px-4 py-2.5 text-sm font-mono bg-muted/20 border border-border focus:border-ring rounded-lg outline-none transition-colors"
              placeholder="key"
            />

            <input
              type="text"
              value={kvValue}
              onChange={(e) => setKvValue(e.target.value)}
              className="w-full px-4 py-2.5 text-sm font-mono bg-muted/20 border border-border focus:border-ring rounded-lg outline-none transition-colors"
              placeholder="value"
            />

            <div className="flex gap-2">
              <button
              type="button"
                onClick={() =>
                  setValueMutation.mutate({ key: kvKey, value: kvValue })
                }
                disabled={isLoading || !kvKey || !kvValue}
                className="flex-1 px-4 py-2.5 text-sm font-mono border border-border hover:border-primary/50 bg-muted/20 hover:bg-muted/40 transition-all rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {setValueMutation.isPending ? "setting..." : "set"}
              </button>
              <button
              type="button"
                onClick={() => getValueMutation.mutate({ key: kvKey })}
                disabled={isLoading || !kvKey}
                className="flex-1 px-4 py-2.5 text-sm font-mono border border-border hover:border-primary/50 bg-muted/20 hover:bg-muted/40 transition-all rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {getValueMutation.isPending ? "getting..." : "get"}
              </button>
            </div>

            {kvResult && (
              <div className="p-4 bg-muted/20 rounded-lg border border-border/50">
                <pre className="text-xs font-mono text-muted-foreground overflow-auto">
                  {JSON.stringify(kvResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
    </div>
  );
}
