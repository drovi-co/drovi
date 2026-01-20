// =============================================================================
// RELATIONSHIPS CARD COMPONENT
// =============================================================================
//
// Shows at-risk relationships and VIPs needing attention.
// One-click meeting prep available.
//

import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Star, User, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

interface Contact {
  id: string;
  displayName?: string | null;
  primaryEmail: string;
  avatarUrl?: string | null;
  company?: string | null;
  title?: string | null;
  isVip?: boolean | null;
  isAtRisk?: boolean | null;
  healthScore?: number | null;
  lastInteractionAt?: Date | null;
  engagementScore?: number | null;
}

interface RelationshipsCardProps {
  atRiskContacts: Contact[];
  vipContacts: Contact[];
  onContactClick?: (id: string) => void;
  onMeetingPrep?: (id: string) => void;
}

function getInitials(name?: string | null, email?: string): string {
  if (name) {
    const parts = name.split(" ");
    return parts
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase();
  }
  return email?.slice(0, 2).toUpperCase() ?? "??";
}

function getHealthClass(score?: number | null): string {
  if (!score) return "bg-muted";
  if (score >= 0.7) return "bg-green-500";
  if (score >= 0.4) return "bg-amber-500";
  return "bg-red-500";
}

export function RelationshipsCard({
  atRiskContacts,
  vipContacts,
  onContactClick,
  onMeetingPrep,
}: RelationshipsCardProps) {
  // Combine and dedupe - at-risk first, then VIPs not already shown
  const atRiskDisplay = atRiskContacts.slice(0, 3);
  const vipDisplay = vipContacts
    .filter((v) => !atRiskContacts.find((a) => a.id === v.id))
    .slice(0, 2);

  const totalToShow = [...atRiskDisplay, ...vipDisplay];
  const hasContent = totalToShow.length > 0;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-xl border bg-card"
      initial={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.4 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-blue-500/10 p-1.5">
            <Users className="h-4 w-4 text-blue-500" />
          </div>
          <h3 className="font-semibold text-sm">Relationships</h3>
          {atRiskContacts.length > 0 && (
            <span className="rounded-full bg-red-500/20 px-2 py-0.5 font-medium text-red-700 text-xs dark:text-red-400">
              {atRiskContacts.length} at risk
            </span>
          )}
        </div>
        <Link to="/dashboard/contacts">
          <Button className="h-7 text-xs" size="sm" variant="ghost">
            All Contacts
            <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </Link>
      </div>

      {/* Content */}
      <div className="divide-y">
        {hasContent ? (
          <>
            {/* At-risk contacts */}
            {atRiskDisplay.map((contact, index) => (
              <motion.div
                animate={{ opacity: 1, x: 0 }}
                className="group p-3 transition-colors hover:bg-muted/30"
                initial={{ opacity: 0, x: -10 }}
                key={contact.id}
                transition={{ delay: index * 0.05 }}
              >
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="relative">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={contact.avatarUrl ?? undefined} />
                      <AvatarFallback className="bg-red-500/10 text-red-700 text-xs dark:text-red-400">
                        {getInitials(contact.displayName, contact.primaryEmail)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute -top-0.5 -right-0.5 rounded-full bg-background p-0.5">
                      <AlertTriangle className="h-3 w-3 text-red-500" />
                    </div>
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-sm">
                        {contact.displayName || contact.primaryEmail}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground text-xs">
                      {contact.company && (
                        <span className="truncate">{contact.company}</span>
                      )}
                      {contact.lastInteractionAt && (
                        <>
                          {contact.company && <span>•</span>}
                          <span className="text-red-500">
                            {formatDistanceToNow(
                              new Date(contact.lastInteractionAt),
                              {
                                addSuffix: true,
                              }
                            )}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      className="h-7 text-xs"
                      onClick={() => onMeetingPrep?.(contact.id)}
                      size="sm"
                      variant="outline"
                    >
                      Meeting Prep
                    </Button>
                    <Button
                      className="h-7 w-7"
                      onClick={() => onContactClick?.(contact.id)}
                      size="icon"
                      variant="ghost"
                    >
                      <User className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            ))}

            {/* VIP contacts */}
            {vipDisplay.map((contact, index) => (
              <motion.div
                animate={{ opacity: 1, x: 0 }}
                className="group p-3 transition-colors hover:bg-muted/30"
                initial={{ opacity: 0, x: -10 }}
                key={contact.id}
                transition={{ delay: (atRiskDisplay.length + index) * 0.05 }}
              >
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="relative">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={contact.avatarUrl ?? undefined} />
                      <AvatarFallback className="bg-amber-500/10 text-amber-700 text-xs dark:text-amber-400">
                        {getInitials(contact.displayName, contact.primaryEmail)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute -top-0.5 -right-0.5 rounded-full bg-background p-0.5">
                      <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                    </div>
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-sm">
                        {contact.displayName || contact.primaryEmail}
                      </p>
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 text-xs dark:text-amber-400">
                        VIP
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground text-xs">
                      {contact.title && (
                        <span className="truncate">{contact.title}</span>
                      )}
                      {contact.company && (
                        <>
                          {contact.title && <span>•</span>}
                          <span className="truncate">{contact.company}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Health indicator */}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <div
                        className={`h-2 w-2 rounded-full ${getHealthClass(contact.healthScore)}`}
                      />
                      <span className="text-muted-foreground text-xs">
                        {contact.healthScore
                          ? `${Math.round(contact.healthScore * 100)}%`
                          : "N/A"}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      className="h-7 text-xs"
                      onClick={() => onMeetingPrep?.(contact.id)}
                      size="sm"
                      variant="outline"
                    >
                      Meeting Prep
                    </Button>
                  </div>
                </div>
              </motion.div>
            ))}
          </>
        ) : (
          <div className="p-6 text-center">
            <Users className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">
              No relationship alerts
            </p>
            <p className="mt-1 text-muted-foreground text-xs">
              All relationships are healthy
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
