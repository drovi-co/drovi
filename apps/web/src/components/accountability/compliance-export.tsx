// =============================================================================
// COMPLIANCE EXPORT
// =============================================================================
//
// Export intelligence data for compliance, audits, and record-keeping.
// Every decision, commitment, and correction in clean, auditable formats.
//

import { env } from "@memorystack/env/web";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  CheckCircle2,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
  GitBranch,
  Loader2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/utils/trpc";

// =============================================================================
// TYPES
// =============================================================================

type ExportFormat = "csv" | "json" | "markdown";
type ExportType = "decisions" | "commitments" | "both";
type DateRange =
  | "all"
  | "this_month"
  | "last_3_months"
  | "last_year"
  | "custom";

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

function generateCSV(
  data: Record<string, unknown>[],
  headers: string[]
): string {
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
      className={cn(
        "rounded-lg border-2 p-4 text-left transition-all",
        "hover:border-primary/50",
        selected ? "border-primary bg-primary/5" : "border-border"
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "rounded-lg p-2",
            selected ? "bg-primary/10 text-primary" : "bg-muted"
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">{title}</h4>
            {count !== undefined && (
              <Badge className="text-xs" variant="secondary">
                {count}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-muted-foreground text-sm">{description}</p>
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
        filename = `drovi-export-${timestamp}.json`;
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
        filename = `drovi-export-${timestamp}.csv`;
        mimeType = "text/csv";
      } else {
        // Markdown
        const items: Array<{
          title: string;
          content: Record<string, unknown>;
        }> = [];

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
                ...(options.includeEvidence &&
                  d.sourceThread && {
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
                Direction:
                  c.direction === "owed_by_me" ? "I owe" : "Owed to me",
                "Due Date": c.dueDate ? new Date(c.dueDate) : "No due date",
                "Created At": new Date(c.createdAt),
                Confidence: `${Math.round(c.confidence * 100)}%`,
                "User Verified": c.isUserVerified ? "Yes" : "No",
                ...(options.includeEvidence &&
                  c.sourceThread && {
                    "Source Thread": c.sourceThread.subject ?? "Thread",
                  }),
              },
            });
          }
        }

        content = generateMarkdown("Drovi Intelligence Export", items);
        filename = `drovi-export-${timestamp}.md`;
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
    <Dialog onOpenChange={setIsOpen} open={isOpen}>
      <DialogTrigger asChild>
        <Button className={className} variant="outline">
          <Download className="mr-2 h-4 w-4" />
          Export for Compliance
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export Intelligence Data</DialogTitle>
          <DialogDescription>
            Export decisions, commitments, and audit trail for compliance and
            record-keeping.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Data Type Selection */}
          <div className="space-y-3">
            <Label className="font-medium text-sm">What to Export</Label>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <ExportTypeCard
                count={decisionsData?.total ?? 0}
                description="All recorded decisions"
                icon={GitBranch}
                onSelect={() =>
                  setOptions((o) => ({ ...o, type: "decisions" }))
                }
                selected={options.type === "decisions"}
                title="Decisions"
              />
              <ExportTypeCard
                count={commitmentsData?.total ?? 0}
                description="All commitments"
                icon={CheckCircle2}
                onSelect={() =>
                  setOptions((o) => ({ ...o, type: "commitments" }))
                }
                selected={options.type === "commitments"}
                title="Commitments"
              />
              <ExportTypeCard
                count={
                  (decisionsData?.total ?? 0) + (commitmentsData?.total ?? 0)
                }
                description="Complete export"
                icon={Users}
                onSelect={() => setOptions((o) => ({ ...o, type: "both" }))}
                selected={options.type === "both"}
                title="Both"
              />
            </div>
          </div>

          <Separator />

          {/* Format Selection */}
          <div className="space-y-3">
            <Label className="font-medium text-sm">Export Format</Label>
            <div className="flex gap-2">
              <Button
                className="flex items-center gap-2"
                onClick={() => setOptions((o) => ({ ...o, format: "csv" }))}
                size="sm"
                type="button"
                variant={options.format === "csv" ? "default" : "outline"}
              >
                <FileSpreadsheet className="h-4 w-4" />
                CSV
              </Button>
              <Button
                className="flex items-center gap-2"
                onClick={() => setOptions((o) => ({ ...o, format: "json" }))}
                size="sm"
                type="button"
                variant={options.format === "json" ? "default" : "outline"}
              >
                <FileJson className="h-4 w-4" />
                JSON
              </Button>
              <Button
                className="flex items-center gap-2"
                onClick={() =>
                  setOptions((o) => ({ ...o, format: "markdown" }))
                }
                size="sm"
                type="button"
                variant={options.format === "markdown" ? "default" : "outline"}
              >
                <FileText className="h-4 w-4" />
                Markdown
              </Button>
            </div>
          </div>

          <Separator />

          {/* Options */}
          <div className="space-y-3">
            <Label className="font-medium text-sm">Options</Label>
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  checked={options.includeSuperseded}
                  id="superseded"
                  onCheckedChange={(v) =>
                    setOptions((o) => ({ ...o, includeSuperseded: !!v }))
                  }
                />
                <Label className="cursor-pointer" htmlFor="superseded">
                  Include superseded decisions
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  checked={options.includeMetadata}
                  id="metadata"
                  onCheckedChange={(v) =>
                    setOptions((o) => ({ ...o, includeMetadata: !!v }))
                  }
                />
                <Label className="cursor-pointer" htmlFor="metadata">
                  Include extraction metadata
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  checked={options.includeEvidence}
                  id="evidence"
                  onCheckedChange={(v) =>
                    setOptions((o) => ({ ...o, includeEvidence: !!v }))
                  }
                />
                <Label className="cursor-pointer" htmlFor="evidence">
                  Include source thread references
                </Label>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => setIsOpen(false)} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={isExporting || isFetchingData || !dataReady}
            onClick={handleExport}
          >
            {isFetchingData ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading data...
              </>
            ) : isExporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
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
