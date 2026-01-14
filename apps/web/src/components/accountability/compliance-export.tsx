// =============================================================================
// COMPLIANCE EXPORT
// =============================================================================
//
// Export intelligence data for compliance, audits, and record-keeping.
// Every decision, commitment, and correction in clean, auditable formats.
//

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Calendar,
  CheckCircle2,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  Filter,
  GitBranch,
  Loader2,
  Users,
} from "lucide-react";
import { useCallback, useState, useEffect } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/utils/trpc";
import { env } from "@memorystack/env/web";

// =============================================================================
// TYPES
// =============================================================================

type ExportFormat = "csv" | "json" | "markdown";
type ExportType = "decisions" | "commitments" | "both";
type DateRange = "all" | "this_month" | "last_3_months" | "last_year" | "custom";

interface ExportOptions {
  format: ExportFormat;
  type: ExportType;
  dateRange: DateRange;
  includeSuperseded: boolean;
  includeMetadata: boolean;
  includeEvidence: boolean;
  includeUserCorrections: boolean;
}

interface ComplianceExportProps {
  organizationId: string;
  className?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function generateCSV(data: Record<string, unknown>[], headers: string[]): string {
  const headerRow = headers.join(",");
  const rows = data.map((item) =>
    headers
      .map((header) => {
        const value = item[header];
        if (value === null || value === undefined) return "";
        if (typeof value === "string") {
          // Escape quotes and wrap in quotes if contains comma
          const escaped = value.replace(/"/g, '""');
          return escaped.includes(",") || escaped.includes("\n")
            ? `"${escaped}"`
            : escaped;
        }
        if (value instanceof Date) return format(value, "yyyy-MM-dd HH:mm:ss");
        return String(value);
      })
      .join(",")
  );
  return [headerRow, ...rows].join("\n");
}

function generateMarkdown(
  title: string,
  items: Array<{ title: string; content: Record<string, unknown> }>
): string {
  let md = `# ${title}\n\n`;
  md += `Generated: ${format(new Date(), "MMMM d, yyyy 'at' h:mm a")}\n\n`;
  md += "---\n\n";

  for (const item of items) {
    md += `## ${item.title}\n\n`;
    for (const [key, value] of Object.entries(item.content)) {
      if (value !== null && value !== undefined) {
        md += `**${key}:** ${value instanceof Date ? format(value, "MMMM d, yyyy") : value}\n\n`;
      }
    }
    md += "---\n\n";
  }

  return md;
}

// =============================================================================
// EXPORT TYPE CARD
// =============================================================================

interface ExportTypeCardProps {
  icon: React.ElementType;
  title: string;
  description: string;
  count?: number;
  selected: boolean;
  onSelect: () => void;
}

function ExportTypeCard({
  icon: Icon,
  title,
  description,
  count,
  selected,
  onSelect,
}: ExportTypeCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "p-4 rounded-lg border-2 text-left transition-all",
        "hover:border-primary/50",
        selected ? "border-primary bg-primary/5" : "border-border"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "p-2 rounded-lg",
            selected ? "bg-primary/10 text-primary" : "bg-muted"
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">{title}</h4>
            {count !== undefined && (
              <Badge variant="secondary" className="text-xs">
                {count}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
      </div>
    </button>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function ComplianceExport({
  organizationId,
  className,
}: ComplianceExportProps) {
  const trpc = useTRPC();
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [options, setOptions] = useState<ExportOptions>({
    format: "csv",
    type: "both",
    dateRange: "all",
    includeSuperseded: false,
    includeMetadata: true,
    includeEvidence: true,
    includeUserCorrections: true,
  });

  // Fetch counts
  const { data: decisionsData } = useQuery(
    trpc.decisions.getStats.queryOptions({ organizationId })
  );
  const { data: commitmentsData } = useQuery(
    trpc.commitments.getStats.queryOptions({ organizationId })
  );

  // State for paginated data collection
  const [allDecisions, setAllDecisions] = useState<unknown[]>([]);
  const [allCommitments, setAllCommitments] = useState<unknown[]>([]);
  const [isFetchingData, setIsFetchingData] = useState(false);
  const [dataReady, setDataReady] = useState(false);

  // Fetch all data when dialog opens (with pagination)
  useEffect(() => {
    if (!isOpen) {
      setAllDecisions([]);
      setAllCommitments([]);
      setDataReady(false);
      return;
    }

    const fetchAllData = async () => {
      setIsFetchingData(true);
      setDataReady(false);

      try {
        // Fetch all decisions if needed
        if (options.type === "decisions" || options.type === "both") {
          const decisions: unknown[] = [];
          let offset = 0;
          const limit = 100;
          let hasMore = true;

          while (hasMore) {
            const response = await fetch(
              `${env.VITE_SERVER_URL}/trpc/decisions.list?input=${encodeURIComponent(
                JSON.stringify({
                  organizationId,
                  limit,
                  offset,
                  includeSuperseded: options.includeSuperseded,
                })
              )}`,
              { credentials: "include" }
            );
            const data = await response.json();
            if (data.result?.data?.decisions) {
              decisions.push(...data.result.data.decisions);
              hasMore = data.result.data.hasMore;
              offset += limit;
            } else {
              hasMore = false;
            }
          }
          setAllDecisions(decisions);
        }

        // Fetch all commitments if needed
        if (options.type === "commitments" || options.type === "both") {
          const commitments: unknown[] = [];
          let offset = 0;
          const limit = 100;
          let hasMore = true;

          while (hasMore) {
            const response = await fetch(
              `${env.VITE_SERVER_URL}/trpc/commitments.list?input=${encodeURIComponent(
                JSON.stringify({
                  organizationId,
                  limit,
                  offset,
                  includeDismissed: false,
                })
              )}`,
              { credentials: "include" }
            );
            const data = await response.json();
            if (data.result?.data?.commitments) {
              commitments.push(...data.result.data.commitments);
              hasMore = data.result.data.hasMore;
              offset += limit;
            } else {
              hasMore = false;
            }
          }
          setAllCommitments(commitments);
        }

        setDataReady(true);
      } catch (error) {
        console.error("Failed to fetch data for export:", error);
        toast.error("Failed to load data for export");
      } finally {
        setIsFetchingData(false);
      }
    };

    fetchAllData();
  }, [isOpen, organizationId, options.type, options.includeSuperseded]);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      let filename: string;
      let content: string;
      let mimeType: string;

      const timestamp = format(new Date(), "yyyy-MM-dd");

      // Cast to proper types for use
      const decisionsToExport = allDecisions as Array<{
        id: string;
        title: string;
        statement: string;
        rationale?: string | null;
        decidedAt: string;
        confidence: number;
        isUserVerified?: boolean;
        supersededById?: string | null;
        metadata?: unknown;
        sourceThread?: { id: string; subject?: string | null } | null;
      }>;

      const commitmentsToExport = allCommitments as Array<{
        id: string;
        title: string;
        description?: string | null;
        status: string;
        priority: string;
        direction: string;
        dueDate?: string | null;
        createdAt: string;
        confidence: number;
        isUserVerified?: boolean;
        metadata?: unknown;
        sourceThread?: { id: string; subject?: string | null } | null;
      }>;

      if (options.format === "json") {
        const exportData: Record<string, unknown> = {
          exportedAt: new Date().toISOString(),
          organizationId,
          options: {
            ...options,
            exportedRecordCounts: {
              decisions: decisionsToExport.length,
              commitments: commitmentsToExport.length,
            },
          },
        };

        if (options.type === "decisions" || options.type === "both") {
          exportData.decisions = decisionsToExport.map((d) => ({
            id: d.id,
            title: d.title,
            statement: d.statement,
            rationale: d.rationale,
            decidedAt: d.decidedAt,
            confidence: d.confidence,
            isUserVerified: d.isUserVerified,
            isSuperseded: !!d.supersededById,
            ...(options.includeMetadata && { metadata: d.metadata }),
            ...(options.includeEvidence && {
              sourceThreadId: d.sourceThread?.id,
              sourceThreadSubject: d.sourceThread?.subject,
            }),
          }));
        }

        if (options.type === "commitments" || options.type === "both") {
          exportData.commitments = commitmentsToExport.map((c) => ({
            id: c.id,
            title: c.title,
            description: c.description,
            status: c.status,
            priority: c.priority,
            direction: c.direction,
            dueDate: c.dueDate,
            createdAt: c.createdAt,
            confidence: c.confidence,
            isUserVerified: c.isUserVerified,
            ...(options.includeMetadata && { metadata: c.metadata }),
            ...(options.includeEvidence && {
              sourceThreadId: c.sourceThread?.id,
              sourceThreadSubject: c.sourceThread?.subject,
            }),
          }));
        }

        content = JSON.stringify(exportData, null, 2);
        filename = `memorystack-export-${timestamp}.json`;
        mimeType = "application/json";
      } else if (options.format === "csv") {
        const rows: Record<string, unknown>[] = [];
        const headers: string[] = [];

        if (options.type === "decisions" || options.type === "both") {
          const decisionHeaders = [
            "type",
            "id",
            "title",
            "statement",
            "rationale",
            "decidedAt",
            "confidence",
            "isUserVerified",
            "isSuperseded",
          ];
          if (options.includeEvidence) {
            decisionHeaders.push("sourceThreadId", "sourceThreadSubject");
          }

          for (const h of decisionHeaders) {
            if (!headers.includes(h)) headers.push(h);
          }

          for (const d of decisionsToExport) {
            rows.push({
              type: "decision",
              id: d.id,
              title: d.title,
              statement: d.statement,
              rationale: d.rationale ?? "",
              decidedAt: d.decidedAt,
              confidence: d.confidence,
              isUserVerified: d.isUserVerified ?? false,
              isSuperseded: !!d.supersededById,
              ...(options.includeEvidence && {
                sourceThreadId: d.sourceThread?.id ?? "",
                sourceThreadSubject: d.sourceThread?.subject ?? "",
              }),
            });
          }
        }

        if (options.type === "commitments" || options.type === "both") {
          const commitmentHeaders = [
            "type",
            "id",
            "title",
            "description",
            "status",
            "priority",
            "direction",
            "dueDate",
            "createdAt",
            "confidence",
            "isUserVerified",
          ];
          if (options.includeEvidence) {
            commitmentHeaders.push("sourceThreadId", "sourceThreadSubject");
          }

          for (const h of commitmentHeaders) {
            if (!headers.includes(h)) headers.push(h);
          }

          for (const c of commitmentsToExport) {
            rows.push({
              type: "commitment",
              id: c.id,
              title: c.title,
              description: c.description ?? "",
              status: c.status,
              priority: c.priority,
              direction: c.direction,
              dueDate: c.dueDate ?? "",
              createdAt: c.createdAt,
              confidence: c.confidence,
              isUserVerified: c.isUserVerified ?? false,
              ...(options.includeEvidence && {
                sourceThreadId: c.sourceThread?.id ?? "",
                sourceThreadSubject: c.sourceThread?.subject ?? "",
              }),
            });
          }
        }

        content = generateCSV(rows, headers);
        filename = `memorystack-export-${timestamp}.csv`;
        mimeType = "text/csv";
      } else {
        // Markdown
        const items: Array<{ title: string; content: Record<string, unknown> }> = [];

        if (options.type === "decisions" || options.type === "both") {
          for (const d of decisionsToExport) {
            items.push({
              title: `[Decision] ${d.title}`,
              content: {
                Statement: d.statement,
                Rationale: d.rationale ?? "Not provided",
                "Decided At": new Date(d.decidedAt),
                Confidence: `${Math.round(d.confidence * 100)}%`,
                "User Verified": d.isUserVerified ? "Yes" : "No",
                Superseded: d.supersededById ? "Yes" : "No",
                ...(options.includeEvidence && d.sourceThread && {
                  "Source Thread": d.sourceThread.subject ?? "Thread",
                }),
              },
            });
          }
        }

        if (options.type === "commitments" || options.type === "both") {
          for (const c of commitmentsToExport) {
            items.push({
              title: `[Commitment] ${c.title}`,
              content: {
                Description: c.description ?? "Not provided",
                Status: c.status,
                Priority: c.priority,
                Direction: c.direction === "owed_by_me" ? "I owe" : "Owed to me",
                "Due Date": c.dueDate ? new Date(c.dueDate) : "No due date",
                "Created At": new Date(c.createdAt),
                Confidence: `${Math.round(c.confidence * 100)}%`,
                "User Verified": c.isUserVerified ? "Yes" : "No",
                ...(options.includeEvidence && c.sourceThread && {
                  "Source Thread": c.sourceThread.subject ?? "Thread",
                }),
              },
            });
          }
        }

        content = generateMarkdown("MEMORYSTACK Intelligence Export", items);
        filename = `memorystack-export-${timestamp}.md`;
        mimeType = "text/markdown";
      }

      // Download
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      toast.success("Export complete!", {
        description: `Saved as ${filename}`,
      });
      setIsOpen(false);
    } catch (error) {
      console.error("Export failed:", error);
      toast.error("Export failed", {
        description: "Please try again",
      });
    } finally {
      setIsExporting(false);
    }
  }, [options, organizationId, allDecisions, allCommitments]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className={className}>
          <Download className="h-4 w-4 mr-2" />
          Export for Compliance
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export Intelligence Data</DialogTitle>
          <DialogDescription>
            Export decisions, commitments, and audit trail for compliance and record-keeping.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Data Type Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">What to Export</Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <ExportTypeCard
                icon={GitBranch}
                title="Decisions"
                description="All recorded decisions"
                count={decisionsData?.total ?? 0}
                selected={options.type === "decisions"}
                onSelect={() => setOptions((o) => ({ ...o, type: "decisions" }))}
              />
              <ExportTypeCard
                icon={CheckCircle2}
                title="Commitments"
                description="All commitments"
                count={commitmentsData?.total ?? 0}
                selected={options.type === "commitments"}
                onSelect={() => setOptions((o) => ({ ...o, type: "commitments" }))}
              />
              <ExportTypeCard
                icon={Users}
                title="Both"
                description="Complete export"
                count={(decisionsData?.total ?? 0) + (commitmentsData?.total ?? 0)}
                selected={options.type === "both"}
                onSelect={() => setOptions((o) => ({ ...o, type: "both" }))}
              />
            </div>
          </div>

          <Separator />

          {/* Format Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Export Format</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={options.format === "csv" ? "default" : "outline"}
                size="sm"
                onClick={() => setOptions((o) => ({ ...o, format: "csv" }))}
                className="flex items-center gap-2"
              >
                <FileSpreadsheet className="h-4 w-4" />
                CSV
              </Button>
              <Button
                type="button"
                variant={options.format === "json" ? "default" : "outline"}
                size="sm"
                onClick={() => setOptions((o) => ({ ...o, format: "json" }))}
                className="flex items-center gap-2"
              >
                <FileJson className="h-4 w-4" />
                JSON
              </Button>
              <Button
                type="button"
                variant={options.format === "markdown" ? "default" : "outline"}
                size="sm"
                onClick={() => setOptions((o) => ({ ...o, format: "markdown" }))}
                className="flex items-center gap-2"
              >
                <FileText className="h-4 w-4" />
                Markdown
              </Button>
            </div>
          </div>

          <Separator />

          {/* Options */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Options</Label>
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="superseded"
                  checked={options.includeSuperseded}
                  onCheckedChange={(v) =>
                    setOptions((o) => ({ ...o, includeSuperseded: !!v }))
                  }
                />
                <Label htmlFor="superseded" className="cursor-pointer">
                  Include superseded decisions
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="metadata"
                  checked={options.includeMetadata}
                  onCheckedChange={(v) =>
                    setOptions((o) => ({ ...o, includeMetadata: !!v }))
                  }
                />
                <Label htmlFor="metadata" className="cursor-pointer">
                  Include extraction metadata
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="evidence"
                  checked={options.includeEvidence}
                  onCheckedChange={(v) =>
                    setOptions((o) => ({ ...o, includeEvidence: !!v }))
                  }
                />
                <Label htmlFor="evidence" className="cursor-pointer">
                  Include source thread references
                </Label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting || isFetchingData || !dataReady}>
            {isFetchingData ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Loading data...
              </>
            ) : isExporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Export ({allDecisions.length + allCommitments.length} records)
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ComplianceExport;
