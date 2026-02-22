import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import { ScrollArea } from "@memorystack/ui-core/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@memorystack/ui-core/sheet";
import {
  Clock,
  ExternalLink,
  FileText,
  Link2,
  Mail,
  Paperclip,
  User,
} from "lucide-react";
import { useSourceDetail } from "@/hooks/use-console-query";

interface SourceViewerSheetProps {
  organizationId: string;
  sourceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function SourceViewerSheet({
  organizationId,
  sourceId,
  open,
  onOpenChange,
}: SourceViewerSheetProps) {
  const {
    data: detail,
    isLoading,
    error,
  } = useSourceDetail(organizationId, open ? sourceId : null);

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="w-[560px] p-0 sm:w-[640px]">
        <SheetHeader className="border-b px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="mb-2 flex items-center gap-2">
                {detail?.source_type ? (
                  <Badge className="capitalize" variant="outline">
                    <Mail className="mr-1 h-3 w-3" />
                    {detail.source_type}
                  </Badge>
                ) : null}
                {detail?.has_attachments ? (
                  <Badge variant="secondary">
                    <Paperclip className="mr-1 h-3 w-3" />
                    {detail.attachments.length}
                  </Badge>
                ) : null}
              </div>
              <SheetTitle className="text-left text-lg">
                {detail?.subject || "Source"}
              </SheetTitle>
            </div>
            {detail?.deep_link ? (
              <Button asChild size="sm" variant="outline">
                <a href={detail.deep_link} rel="noopener noreferrer" target="_blank">
                  <ExternalLink className="mr-1.5 h-4 w-4" />
                  Open Original
                </a>
              </Button>
            ) : null}
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-84px)]">
          <div className="space-y-6 px-6 py-5">
            {!sourceId ? (
              <p className="text-muted-foreground text-sm">
                Select a source to view details.
              </p>
            ) : null}

            {isLoading ? (
              <p className="text-muted-foreground text-sm">Loading source...</p>
            ) : null}

            {error ? (
              <p className="text-destructive text-sm">
                Failed to load source details.
              </p>
            ) : null}

            {detail ? (
              <>
                <div className="grid gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
                  {detail.sender_name || detail.sender_email ? (
                    <div className="flex items-start gap-2">
                      <User className="mt-0.5 h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium text-foreground">
                          {detail.sender_name || detail.sender_email}
                        </p>
                        {detail.sender_name && detail.sender_email ? (
                          <p className="text-muted-foreground">
                            {detail.sender_email}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {detail.recipients?.length ? (
                    <div className="flex items-start gap-2">
                      <Mail className="mt-0.5 h-4 w-4 text-muted-foreground" />
                      <div className="text-muted-foreground">
                        To:{" "}
                        {detail.recipients
                          .map((recipient) =>
                            recipient.name || recipient.email || "Unknown"
                          )
                          .join(", ")}
                      </div>
                    </div>
                  ) : null}

                  {detail.sent_at || detail.received_at ? (
                    <div className="flex items-start gap-2">
                      <Clock className="mt-0.5 h-4 w-4 text-muted-foreground" />
                      <div className="text-muted-foreground">
                        {formatDateTime(detail.sent_at) ||
                          formatDateTime(detail.received_at)}
                      </div>
                    </div>
                  ) : null}

                  <div className="flex items-start gap-2">
                    <Link2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <code className="break-all text-muted-foreground text-xs">
                      {detail.source_id}
                    </code>
                  </div>
                </div>

                {detail.quoted_text ? (
                  <div>
                    <h4 className="mb-2 font-medium text-foreground text-sm">
                      Quoted Evidence
                    </h4>
                    <blockquote className="rounded-r-md border-blue-500 border-l-2 bg-muted/30 px-3 py-2 text-foreground text-sm italic">
                      "{detail.quoted_text}"
                    </blockquote>
                  </div>
                ) : null}

                {detail.body_text || detail.body_html || detail.snippet ? (
                  <div>
                    <h4 className="mb-2 flex items-center gap-2 font-medium text-foreground text-sm">
                      <FileText className="h-4 w-4" />
                      Source Content
                    </h4>
                    <div className="max-h-[340px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-4 text-foreground text-sm">
                      {detail.body_text || detail.snippet || "No text content"}
                    </div>
                  </div>
                ) : null}

                {detail.related_uios?.length ? (
                  <div>
                    <h4 className="mb-2 font-medium text-foreground text-sm">
                      Related Items ({detail.related_uios.length})
                    </h4>
                    <div className="space-y-2">
                      {detail.related_uios.map((uio) => (
                        <div
                          className="rounded-lg border border-border bg-muted/20 px-3 py-2"
                          key={uio.id}
                        >
                          <p className="font-medium text-foreground text-sm">
                            {uio.title}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {uio.type} • {uio.status}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
