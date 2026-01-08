/**
 * Entity Tag Utilities
 *
 * Parses [[type:name]] patterns and renders with type-specific colors.
 */

import { cn } from '../lib/utils';

export type EntityType = 'topic' | 'misconception' | 'strategy' | 'context' | 'constraint' | 'outcome' | 'concept';

export interface ParsedEntity {
  type: EntityType;
  name: string;
  raw: string;
}

/**
 * Entity type color classes
 */
export const entityTypeColors: Record<EntityType, { bg: string; text: string; border: string }> = {
  topic: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-500',
    border: 'border-blue-500/20',
  },
  misconception: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-500',
    border: 'border-amber-500/20',
  },
  strategy: {
    bg: 'bg-green-500/10',
    text: 'text-green-500',
    border: 'border-green-500/20',
  },
  context: {
    bg: 'bg-purple-500/10',
    text: 'text-purple-500',
    border: 'border-purple-500/20',
  },
  constraint: {
    bg: 'bg-red-500/10',
    text: 'text-red-500',
    border: 'border-red-500/20',
  },
  outcome: {
    bg: 'bg-cyan-500/10',
    text: 'text-cyan-500',
    border: 'border-cyan-500/20',
  },
  concept: {
    bg: 'bg-primary/10',
    text: 'text-primary',
    border: 'border-primary/20',
  },
};

/**
 * Parse entity tags from text.
 * Supports both [[type:name]] and [[name]] formats.
 */
export function parseEntityTags(text: string): Array<{ start: number; end: number; entity: ParsedEntity }> {
  const results: Array<{ start: number; end: number; entity: ParsedEntity }> = [];

  // Match [[type:name]] or [[name]]
  const regex = /\[\[(?:(\w+):)?([^\]]+)\]\]/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const type = (match[1]?.toLowerCase() || 'concept') as EntityType;
    const name = match[2]!.trim();

    results.push({
      start: match.index,
      end: match.index + match[0].length,
      entity: {
        type: isValidEntityType(type) ? type : 'concept',
        name,
        raw: match[0],
      },
    });
  }

  return results;
}

function isValidEntityType(type: string): type is EntityType {
  return ['topic', 'misconception', 'strategy', 'context', 'constraint', 'outcome', 'concept'].includes(type);
}

/**
 * Entity tag component
 */
export function EntityTag({
  type,
  name,
  showType = false,
  className,
}: {
  type: EntityType;
  name: string;
  showType?: boolean;
  className?: string;
}) {
  const colors = entityTypeColors[type] || entityTypeColors.concept;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 text-xs font-mono rounded border',
        colors.bg,
        colors.text,
        colors.border,
        className
      )}
      title={`${type}: ${name}`}
    >
      {showType && (
        <span className="opacity-60 text-[10px]">{type}:</span>
      )}
      {name}
    </span>
  );
}

/**
 * Render text content with entity tags highlighted
 */
export function renderContentWithEntities(content: string): React.ReactNode[] {
  if (!content) return [];

  const tags = parseEntityTags(content);

  if (tags.length === 0) {
    return [<span key="0">{content}</span>];
  }

  const result: React.ReactNode[] = [];
  let lastIndex = 0;

  tags.forEach((tag, i) => {
    // Add text before this tag
    if (tag.start > lastIndex) {
      result.push(
        <span key={`text-${i}`}>{content.slice(lastIndex, tag.start)}</span>
      );
    }

    // Add the entity tag
    result.push(
      <EntityTag
        key={`entity-${i}`}
        type={tag.entity.type}
        name={tag.entity.name}
      />
    );

    lastIndex = tag.end;
  });

  // Add remaining text
  if (lastIndex < content.length) {
    result.push(
      <span key="text-end">{content.slice(lastIndex)}</span>
    );
  }

  return result;
}

/**
 * Get color classes for entity type (for trajectory bar)
 */
export function getEntityTypeColorClasses(entityType?: string): string {
  const type = (entityType?.toLowerCase() || 'concept') as EntityType;
  const colors = entityTypeColors[type] || entityTypeColors.concept;
  return cn(colors.bg, colors.text);
}
