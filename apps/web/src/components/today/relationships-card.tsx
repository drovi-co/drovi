// =============================================================================
// RELATIONSHIPS CARD COMPONENT
// =============================================================================
//
// Shows at-risk relationships and VIPs needing attention.
// One-click meeting prep available.
//

import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  Star,
  User,
  Users,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

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
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="bg-card rounded-xl border overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-blue-500/10">
            <Users className="h-4 w-4 text-blue-500" />
          </div>
          <h3 className="font-semibold text-sm">Relationships</h3>
          {atRiskContacts.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-700 dark:text-red-400">
              {atRiskContacts.length} at risk
            </span>
          )}
        </div>
        <Link to="/dashboard/contacts">
          <Button variant="ghost" size="sm" className="text-xs h-7">
            All Contacts
            <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </Link>
      </div>

      {/* Content */}
      <div className="divide-y">
        {!hasContent ? (
          <div className="p-6 text-center">
            <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No relationship alerts</p>
            <p className="text-xs text-muted-foreground mt-1">
              All relationships are healthy
            </p>
          </div>
        ) : (
          <>
            {/* At-risk contacts */}
            {atRiskDisplay.map((contact, index) => (
              <motion.div
                key={contact.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="p-3 hover:bg-muted/30 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="relative">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={contact.avatarUrl ?? undefined} />
                      <AvatarFallback className="bg-red-500/10 text-red-700 dark:text-red-400 text-xs">
                        {getInitials(contact.displayName, contact.primaryEmail)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute -top-0.5 -right-0.5 p-0.5 bg-background rounded-full">
                      <AlertTriangle className="h-3 w-3 text-red-500" />
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">
                        {contact.displayName || contact.primaryEmail}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {contact.company && (
                        <span className="truncate">{contact.company}</span>
                      )}
                      {contact.lastInteractionAt && (
                        <>
                          {contact.company && <span>•</span>}
                          <span className="text-red-500">
                            {formatDistanceToNow(new Date(contact.lastInteractionAt), {
                              addSuffix: true,
                            })}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => onMeetingPrep?.(contact.id)}
                    >
                      Meeting Prep
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onContactClick?.(contact.id)}
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
                key={contact.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: (atRiskDisplay.length + index) * 0.05 }}
                className="p-3 hover:bg-muted/30 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="relative">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={contact.avatarUrl ?? undefined} />
                      <AvatarFallback className="bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs">
                        {getInitials(contact.displayName, contact.primaryEmail)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute -top-0.5 -right-0.5 p-0.5 bg-background rounded-full">
                      <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">
                        {contact.displayName || contact.primaryEmail}
                      </p>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400">
                        VIP
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {contact.title && <span className="truncate">{contact.title}</span>}
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
                      <span className="text-xs text-muted-foreground">
                        {contact.healthScore
                          ? `${Math.round(contact.healthScore * 100)}%`
                          : "N/A"}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => onMeetingPrep?.(contact.id)}
                    >
                      Meeting Prep
                    </Button>
                  </div>
                </div>
              </motion.div>
            ))}
          </>
        )}
      </div>
    </motion.div>
  );
}
