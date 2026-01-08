/**
 * ChatInput Component
 *
 * Input field with send/stop button for the chat interface.
 * Supports keyboard shortcuts (Enter to send).
 */

import { useState, useRef, useEffect } from "react";
import { cn } from "../../lib/utils";

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  onStop,
  disabled = false,
  isStreaming = false,
  placeholder = "Type a message...",
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 150)}px`;
    }
  }, [value]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed && !disabled && !isStreaming) {
      onSend(trimmed);
      setValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex items-end gap-2">
      <div className="relative flex-1">
        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          className={cn(
            "w-full resize-none rounded-lg border border-border/50 bg-muted/20 px-4 py-3",
            "text-sm placeholder:text-muted-foreground/60",
            "focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "transition-all duration-200"
          )}
        />
      </div>

      {isStreaming ? (
        <button
          onClick={onStop}
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-lg",
            "bg-destructive text-destructive-foreground",
            "hover:bg-destructive/90 active:scale-95",
            "transition-all duration-200"
          )}
          title="Stop generating"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-5 w-5"
          >
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      ) : (
        <button
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-lg",
            "bg-primary text-primary-foreground",
            "hover:bg-primary/90 active:scale-95",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "transition-all duration-200"
          )}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <path d="m22 2-7 20-4-9-9-4Z" />
            <path d="M22 2 11 13" />
          </svg>
        </button>
      )}
    </div>
  );
}
