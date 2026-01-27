"use client";

/**
 * MentionInput
 *
 * Text input with @mention autocomplete support.
 * Triggers dropdown on @ keystroke for selecting users/teams.
 */

import { useQuery } from "@tanstack/react-query";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useTRPC } from "@/utils/trpc";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Users, AtSign } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

export interface MentionSuggestion {
  id: string;
  type: "user" | "team" | "all";
  name: string;
  email?: string;
  image?: string | null;
}

export interface MentionData {
  type: "user" | "team" | "all";
  id?: string;
  text: string;
}

interface MentionInputProps {
  organizationId: string;
  value: string;
  onChange: (value: string) => void;
  onMention?: (mention: MentionData) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  minRows?: number;
  maxRows?: number;
}

export interface MentionInputRef {
  focus: () => void;
  blur: () => void;
  insertMention: (mention: MentionSuggestion) => void;
}

// =============================================================================
// Component
// =============================================================================

export const MentionInput = forwardRef<MentionInputRef, MentionInputProps>(
  function MentionInput(
    {
      organizationId,
      value,
      onChange,
      onMention,
      placeholder = "Type @ to mention someone...",
      className,
      disabled = false,
      autoFocus = false,
      minRows = 1,
      maxRows = 6,
    },
    ref
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [mentionQuery, setMentionQuery] = useState("");
    const [mentionStart, setMentionStart] = useState<number | null>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);

    const trpc = useTRPC();

    // Fetch org members for suggestions
    const { data: membersData } = useQuery(
      trpc.organizations.getMembers.queryOptions(
        { organizationId },
        { enabled: !!organizationId }
      )
    );

    // Fetch teams for suggestions
    const { data: teamsData } = useQuery(
      trpc.organizations.getTeams.queryOptions(
        { organizationId },
        { enabled: !!organizationId }
      )
    );

    // Build suggestions list
    const suggestions: MentionSuggestion[] = [];

    // Add @all option
    if (
      mentionQuery === "" ||
      "all".includes(mentionQuery.toLowerCase()) ||
      "everyone".includes(mentionQuery.toLowerCase())
    ) {
      suggestions.push({
        id: "all",
        type: "all",
        name: "Everyone",
      });
    }

    // Add team suggestions
    const teams = teamsData?.teams ?? [];
    for (const team of teams) {
      if (
        mentionQuery === "" ||
        team.name.toLowerCase().includes(mentionQuery.toLowerCase())
      ) {
        suggestions.push({
          id: team.id,
          type: "team",
          name: team.name,
        });
      }
    }

    // Add user suggestions
    const members = membersData?.members ?? [];
    for (const member of members) {
      if (
        mentionQuery === "" ||
        member.user?.name?.toLowerCase().includes(mentionQuery.toLowerCase()) ||
        member.user?.email?.toLowerCase().includes(mentionQuery.toLowerCase())
      ) {
        suggestions.push({
          id: member.userId,
          type: "user",
          name: member.user?.name ?? "Unknown",
          email: member.user?.email,
          image: member.user?.image,
        });
      }
    }

    // Limit suggestions
    const limitedSuggestions = suggestions.slice(0, 8);

    // Handle text input
    const handleInput = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        const cursorPos = e.target.selectionStart;

        onChange(newValue);

        // Check for @ trigger
        if (cursorPos > 0) {
          const beforeCursor = newValue.slice(0, cursorPos);
          const atMatch = beforeCursor.match(/@(\w*)$/);

          if (atMatch) {
            setMentionStart(atMatch.index!);
            setMentionQuery(atMatch[1]);
            setIsOpen(true);
            setSelectedIndex(0);
          } else {
            setIsOpen(false);
            setMentionStart(null);
            setMentionQuery("");
          }
        } else {
          setIsOpen(false);
          setMentionStart(null);
          setMentionQuery("");
        }
      },
      [onChange]
    );

    // Handle keyboard navigation
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (!isOpen) return;

        switch (e.key) {
          case "ArrowDown":
            e.preventDefault();
            setSelectedIndex((i) =>
              i < limitedSuggestions.length - 1 ? i + 1 : 0
            );
            break;
          case "ArrowUp":
            e.preventDefault();
            setSelectedIndex((i) =>
              i > 0 ? i - 1 : limitedSuggestions.length - 1
            );
            break;
          case "Enter":
          case "Tab":
            if (limitedSuggestions[selectedIndex]) {
              e.preventDefault();
              insertMention(limitedSuggestions[selectedIndex]);
            }
            break;
          case "Escape":
            e.preventDefault();
            setIsOpen(false);
            break;
        }
      },
      [isOpen, limitedSuggestions, selectedIndex]
    );

    // Insert mention into text
    const insertMention = useCallback(
      (suggestion: MentionSuggestion) => {
        if (mentionStart === null) return;

        const before = value.slice(0, mentionStart);
        const after = value.slice(
          mentionStart + 1 + mentionQuery.length
        );

        const mentionText =
          suggestion.type === "all"
            ? "@everyone"
            : suggestion.type === "team"
              ? `@${suggestion.name.replace(/\s/g, "_")}`
              : `@${suggestion.name.replace(/\s/g, "_")}`;

        const newValue = `${before}${mentionText} ${after}`;
        onChange(newValue);

        // Fire mention callback
        if (onMention) {
          onMention({
            type: suggestion.type,
            id: suggestion.type !== "all" ? suggestion.id : undefined,
            text: mentionText,
          });
        }

        // Close dropdown
        setIsOpen(false);
        setMentionStart(null);
        setMentionQuery("");

        // Focus back to textarea
        setTimeout(() => {
          textareaRef.current?.focus();
          const cursorPos = before.length + mentionText.length + 1;
          textareaRef.current?.setSelectionRange(cursorPos, cursorPos);
        }, 0);
      },
      [mentionStart, mentionQuery, value, onChange, onMention]
    );

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
      blur: () => textareaRef.current?.blur(),
      insertMention,
    }));

    // Auto-resize textarea
    useEffect(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      textarea.style.height = "auto";
      const lineHeight = 24; // Approximate line height
      const minHeight = minRows * lineHeight;
      const maxHeight = maxRows * lineHeight;
      const scrollHeight = textarea.scrollHeight;

      textarea.style.height = `${Math.min(Math.max(scrollHeight, minHeight), maxHeight)}px`;
    }, [value, minRows, maxRows]);

    return (
      <div className="relative">
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverAnchor asChild>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              autoFocus={autoFocus}
              className={cn(
                "flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                className
              )}
              rows={minRows}
            />
          </PopoverAnchor>

          <PopoverContent
            className="w-64 p-0"
            align="start"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <Command>
              <CommandList>
                <CommandEmpty>No suggestions found</CommandEmpty>
                <CommandGroup heading="Mentions">
                  {limitedSuggestions.map((suggestion, index) => (
                    <CommandItem
                      key={`${suggestion.type}-${suggestion.id}`}
                      value={`${suggestion.type}-${suggestion.id}`}
                      onSelect={() => insertMention(suggestion)}
                      className={cn(
                        "flex items-center gap-2",
                        index === selectedIndex && "bg-accent"
                      )}
                    >
                      {suggestion.type === "all" ? (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10">
                          <AtSign className="h-3.5 w-3.5 text-primary" />
                        </div>
                      ) : suggestion.type === "team" ? (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
                          <Users className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                        </div>
                      ) : (
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={suggestion.image ?? undefined} />
                          <AvatarFallback className="text-xs">
                            {suggestion.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")
                              .toUpperCase()
                              .slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">
                          {suggestion.name}
                        </span>
                        {suggestion.email && (
                          <span className="text-xs text-muted-foreground">
                            {suggestion.email}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    );
  }
);
