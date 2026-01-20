"use client";

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Calendar as CalendarIcon, Loader2, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { CalendarView } from "@/components/calendar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveOrganization } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/calendar")({
  component: CalendarPage,
});

// =============================================================================
// CALENDAR PAGE
// =============================================================================

function CalendarPage() {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null
  );
  const { data: activeOrg } = useActiveOrganization();

  // Fetch email accounts
  const { data: accounts, isLoading: isLoadingAccounts } = useQuery({
    ...trpc.emailAccounts.list.queryOptions({
      organizationId: activeOrg?.id ?? "",
    }),
    staleTime: 60_000,
    enabled: Boolean(activeOrg?.id),
  });

  // Set default account when accounts load
  useEffect(() => {
    if (accounts && accounts.length > 0 && !selectedAccountId) {
      // Prefer Gmail accounts as they have better calendar support
      const gmailAccount = accounts.find((a) => a.provider === "gmail");
      setSelectedAccountId(gmailAccount?.id ?? accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  // Loading state
  if (!activeOrg || isLoadingAccounts) {
    return (
      <div
        className="flex h-full items-center justify-center"
        data-no-shell-padding
      >
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading calendar...
        </div>
      </div>
    );
  }

  // No accounts state
  if (!accounts || accounts.length === 0) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center p-8 text-center"
        data-no-shell-padding
      >
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <CalendarIcon className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="mb-2 font-semibold text-xl">Connect an email account</h2>
        <p className="mb-6 max-w-md text-muted-foreground">
          Connect your Gmail or Outlook account to view and manage your calendar
          events.
        </p>
        <Button asChild>
          <Link to="/dashboard/email-accounts">
            <Mail className="mr-2 h-4 w-4" />
            Connect Account
          </Link>
        </Button>
      </div>
    );
  }

  // No selected account (shouldn't happen, but just in case)
  if (!selectedAccountId) {
    return null;
  }

  return (
    <div className="flex h-full flex-col" data-no-shell-padding>
      {/* Account selector if multiple accounts */}
      {accounts.length > 1 && (
        <div className="flex items-center gap-3 border-b bg-background px-4 py-2">
          <span className="text-muted-foreground text-sm">Calendar:</span>
          <Select
            onValueChange={setSelectedAccountId}
            value={selectedAccountId}
          >
            <SelectTrigger className="h-8 w-[280px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        account.provider === "gmail"
                          ? "text-red-500"
                          : "text-blue-500"
                      }
                    >
                      {account.provider === "gmail" ? "G" : "O"}
                    </span>
                    {account.email}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Calendar view */}
      <div className="flex-1 overflow-hidden">
        <CalendarView accountId={selectedAccountId} className="h-full" />
      </div>
    </div>
  );
}
