"use client";

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Calendar as CalendarIcon, Mail, Loader2 } from "lucide-react";
import { trpc } from "@/utils/trpc";
import { CalendarView } from "@/components/calendar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { useActiveOrganization } from "@/lib/auth-client";

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
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const { data: activeOrg } = useActiveOrganization();

  // Fetch email accounts
  const { data: accounts, isLoading: isLoadingAccounts } = useQuery({
    ...trpc.emailAccounts.list.queryOptions({
      organizationId: activeOrg?.id ?? "",
    }),
    staleTime: 60000,
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
      <div data-no-shell-padding className="h-full flex items-center justify-center">
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
      <div data-no-shell-padding className="h-full flex flex-col items-center justify-center text-center p-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-6">
          <CalendarIcon className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Connect an email account</h2>
        <p className="text-muted-foreground max-w-md mb-6">
          Connect your Gmail or Outlook account to view and manage your calendar
          events.
        </p>
        <Button asChild>
          <Link to="/dashboard/email-accounts">
            <Mail className="h-4 w-4 mr-2" />
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
    <div data-no-shell-padding className="h-full flex flex-col">
      {/* Account selector if multiple accounts */}
      {accounts.length > 1 && (
        <div className="border-b px-4 py-2 bg-background flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Calendar:</span>
          <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
            <SelectTrigger className="w-[280px] h-8">
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
        <CalendarView
          accountId={selectedAccountId}
          className="h-full"
        />
      </div>
    </div>
  );
}
