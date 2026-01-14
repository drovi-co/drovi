import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/utils/trpc";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useCallback, useRef, useState } from "react";

// =============================================================================
// TYPES
// =============================================================================

export interface Recipient {
  email: string;
  name?: string;
}

interface RecipientFieldProps {
  label: string;
  recipients: Recipient[];
  onRecipientsChange: (recipients: Recipient[]) => void;
  organizationId: string;
  placeholder?: string;
  className?: string;
}

// =============================================================================
// RECIPIENT FIELD
// =============================================================================

export function RecipientField({
  label,
  recipients,
  onRecipientsChange,
  organizationId,
  placeholder = "Add recipient...",
  className,
}: RecipientFieldProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const trpc = useTRPC();

  // Search contacts
  const { data: contactsData } = useQuery({
    ...trpc.contacts.list.queryOptions({
      organizationId,
      search: inputValue,
      limit: 10,
    }),
    enabled: inputValue.length >= 2 && !!organizationId,
  });

  // contacts.list returns { contacts, total, hasMore }
  const contacts = contactsData?.contacts ?? [];

  // Add a recipient
  const addRecipient = useCallback(
    (recipient: Recipient) => {
      // Check if already added
      if (recipients.some((r) => r.email === recipient.email)) {
        return;
      }
      onRecipientsChange([...recipients, recipient]);
      setInputValue("");
      setOpen(false);
      inputRef.current?.focus();
    },
    [recipients, onRecipientsChange]
  );

  // Remove a recipient
  const removeRecipient = useCallback(
    (email: string) => {
      onRecipientsChange(recipients.filter((r) => r.email !== email));
    },
    [recipients, onRecipientsChange]
  );

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Backspace on empty input removes last recipient
      if (e.key === "Backspace" && inputValue === "" && recipients.length > 0) {
        const lastRecipient = recipients.at(-1);
        if (lastRecipient) {
          removeRecipient(lastRecipient.email);
        }
        return;
      }

      // Enter or comma adds the current input as an email
      if ((e.key === "Enter" || e.key === ",") && inputValue.trim()) {
        e.preventDefault();
        const email = inputValue.trim().replace(/,$/, "");

        // Basic email validation
        if (email.includes("@") && email.includes(".")) {
          addRecipient({ email });
        }
        return;
      }

      // Tab should move to next field
      if (e.key === "Tab" && inputValue.trim()) {
        e.preventDefault();
        const email = inputValue.trim();
        if (email.includes("@") && email.includes(".")) {
          addRecipient({ email });
        }
      }
    },
    [inputValue, recipients, addRecipient, removeRecipient]
  );

  // Handle paste - support pasting multiple emails
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text");

      // Split by comma, semicolon, or newline
      const emails = text.split(/[,;\n\r]+/).map((s) => s.trim()).filter(Boolean);

      const newRecipients: Recipient[] = [];
      for (const email of emails) {
        if (
          email.includes("@") &&
          email.includes(".") &&
          !recipients.some((r) => r.email === email)
        ) {
          newRecipients.push({ email });
        }
      }

      if (newRecipients.length > 0) {
        onRecipientsChange([...recipients, ...newRecipients]);
      }
    },
    [recipients, onRecipientsChange]
  );

  return (
    <div
      className={cn(
        "flex items-start gap-2 border-b px-4 py-3 focus-within:bg-muted/30",
        className
      )}
    >
      <span className="w-10 shrink-0 pt-0.5 text-muted-foreground text-sm">
        {label}
      </span>
      <div className="flex flex-1 flex-wrap items-center gap-1">
        {recipients.map((recipient) => (
          <Badge
            key={recipient.email}
            variant="secondary"
            className="gap-1 py-0.5 pl-2 pr-1"
          >
            <span className="truncate max-w-[200px]">
              {recipient.name || recipient.email}
            </span>
            <button
              type="button"
              onClick={() => removeRecipient(recipient.email)}
              className="rounded-full p-0.5 hover:bg-muted"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                if (e.target.value.length >= 2) {
                  setOpen(true);
                }
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onFocus={() => inputValue.length >= 2 && setOpen(true)}
              placeholder={recipients.length === 0 ? placeholder : ""}
              className="flex-1 min-w-[200px] bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </PopoverTrigger>
          <PopoverContent
            className="w-[320px] p-0"
            align="start"
            side="bottom"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <Command shouldFilter={false}>
              <CommandList>
                <CommandEmpty className="py-4 text-center text-muted-foreground text-sm">
                  {inputValue.length < 2
                    ? "Type to search contacts..."
                    : "No contacts found"}
                </CommandEmpty>
                {contacts.length > 0 && (
                  <CommandGroup heading="Contacts">
                    {contacts.map((contact) => (
                      <CommandItem
                        key={contact.id}
                        onSelect={() =>
                          addRecipient({
                            email: contact.primaryEmail,
                            name: contact.displayName ?? undefined,
                          })
                        }
                        className="cursor-pointer"
                      >
                        <div className="flex flex-col">
                          {contact.displayName && (
                            <span className="font-medium">
                              {contact.displayName}
                            </span>
                          )}
                          <span className="text-muted-foreground text-xs">
                            {contact.primaryEmail}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {/* Allow adding typed email as new recipient */}
                {inputValue.includes("@") && inputValue.includes(".") && (
                  <CommandGroup heading="Add new">
                    <CommandItem
                      onSelect={() => addRecipient({ email: inputValue })}
                      className="cursor-pointer"
                    >
                      <span className="text-muted-foreground">Add: </span>
                      <span>{inputValue}</span>
                    </CommandItem>
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
