// =============================================================================
// LINKED DESCRIPTION COMPONENT
// =============================================================================
//
// Renders text with intelligent entity linking. Contacts and companies
// mentioned in the text are rendered as clickable links with avatars.
//
// Example: "Elias at Shopify reported that..." renders:
// - "Elias" with avatar, clickable to contact profile
// - "Shopify" with logo, clickable to company profile

import { useNavigate } from "@tanstack/react-router";

import { EntityLink } from "@/components/inbox/entity-badge";
import type { LinkedEntity } from "@/lib/entity-parser";
import { parseEntityMentions } from "@/lib/entity-parser";
import { cn } from "@/lib/utils";

// =============================================================================
// TYPES
// =============================================================================

export interface LinkedDescriptionProps {
  /** The text to render with entity linking */
  text: string;
  /** Entities to link in the text */
  entities?: LinkedEntity[];
  /** Additional class names */
  className?: string;
  /** Maximum lines to show (will truncate with ellipsis) */
  maxLines?: number;
  /** Custom click handler for entities (overrides default navigation) */
  onEntityClick?: (entity: LinkedEntity) => void;
}

// =============================================================================
// LINKED DESCRIPTION COMPONENT
// =============================================================================

export function LinkedDescription({
  text,
  entities = [],
  className,
  maxLines,
  onEntityClick,
}: LinkedDescriptionProps) {
  const navigate = useNavigate();

  // Parse text into parts with entity linking
  const parts = parseEntityMentions(text, entities);

  // Handle entity click - navigate to appropriate page
  const handleEntityClick = (entity: LinkedEntity) => {
    if (onEntityClick) {
      onEntityClick(entity);
      return;
    }

    // Default navigation based on entity type
    // Note: Only contacts have a detail page currently
    if (entity.type === "contact") {
      navigate({
        to: "/dashboard/contacts/$contactId",
        params: { contactId: entity.id },
      });
    }
    // Companies route not yet implemented - clicking will be a no-op for now
  };

  return (
    <p
      className={cn(
        "text-sm leading-relaxed",
        maxLines && `line-clamp-${maxLines}`,
        className
      )}
      style={
        maxLines
          ? {
              display: "-webkit-box",
              WebkitLineClamp: maxLines,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }
          : undefined
      }
    >
      {parts.map((part, index) => {
        const key = `${part.type}-${index}-${part.content.slice(0, 10)}`;

        if (part.type === "text") {
          return <span key={key}>{part.content}</span>;
        }

        if (part.type === "contact" && part.entity) {
          const entity = part.entity;
          return (
            <EntityLink
              avatarUrl={entity.avatarUrl}
              id={entity.id}
              key={key}
              name={entity.name}
              onClick={() => handleEntityClick(entity)}
              type="contact"
            >
              {part.content}
            </EntityLink>
          );
        }

        if (part.type === "company" && part.entity) {
          const entity = part.entity;
          return (
            <EntityLink
              avatarUrl={entity.avatarUrl}
              id={entity.id}
              key={key}
              name={entity.name}
              onClick={() => handleEntityClick(entity)}
              type="company"
            >
              {part.content}
            </EntityLink>
          );
        }

        if (part.type === "reference") {
          return (
            <span
              className="cursor-help underline decoration-muted-foreground/50 decoration-dotted"
              key={key}
              title="Reference"
            >
              {part.content}
            </span>
          );
        }

        // Fallback for unknown types
        return <span key={key}>{part.content}</span>;
      })}
    </p>
  );
}

// =============================================================================
// SIMPLE DESCRIPTION (no entity linking, just truncation)
// =============================================================================

export interface SimpleDescriptionProps {
  text: string;
  className?: string;
  maxLines?: number;
}

export function SimpleDescription({
  text,
  className,
  maxLines = 2,
}: SimpleDescriptionProps) {
  return (
    <p
      className={cn("text-muted-foreground text-sm", className)}
      style={{
        display: "-webkit-box",
        WebkitLineClamp: maxLines,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }}
    >
      {text}
    </p>
  );
}
