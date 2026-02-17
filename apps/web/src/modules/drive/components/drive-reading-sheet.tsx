import { Badge } from "@memorystack/ui-core/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@memorystack/ui-core/sheet";
import { BookOpenText, Loader2 } from "lucide-react";
import { DriveDocumentViewer } from "@/components/drive/document-viewer";
import { type DriveDocument, type DriveDocumentChunk } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  type TranslateFn,
  fileDisplayTitle,
  formatBytes,
  normalizeFolderPath,
  statusBadge,
} from "../pages/drive-page-helpers";

interface DriveReadingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDoc: DriveDocument | null;
  selectedDocId: string | null;
  selectedChunkId: string | null;
  highlightQuote: string | null;
  organizationId: string;
  chunks: DriveDocumentChunk[];
  chunksLoading: boolean;
  onChunkSelect: (chunkId: string) => void;
  t: TranslateFn;
}

export function DriveReadingSheet({
  open,
  onOpenChange,
  selectedDoc,
  selectedDocId,
  selectedChunkId,
  highlightQuote,
  organizationId,
  chunks,
  chunksLoading,
  onChunkSelect,
  t,
}: DriveReadingSheetProps) {
  return (
    <Sheet onOpenChange={onOpenChange} open={open && Boolean(selectedDocId)}>
      <SheetContent className="!w-full overflow-hidden border-border/75 bg-card/95 p-0 sm:!w-[90vw] sm:!max-w-none">
        <div className="flex h-full flex-col">
          <SheetHeader className="border-border/70 border-b px-6 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
              <div className="space-y-1">
                <p className="old-money-kicker text-[9px]">Reading mode</p>
                <SheetTitle className="font-serif text-xl">
                  {selectedDoc ? fileDisplayTitle(selectedDoc) : "Archive record"}
                </SheetTitle>
                <SheetDescription className="text-sm">
                  {selectedDoc
                    ? `${normalizeFolderPath(selectedDoc.folderPath)} · ${formatBytes(selectedDoc.byteSize)}`
                    : "Select a file from the archive to inspect evidence."}
                </SheetDescription>
              </div>
              {selectedDoc ? statusBadge(selectedDoc.status, t) : null}
            </div>
          </SheetHeader>

          <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="border-border/70 border-r bg-muted/25 px-4 py-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-medium text-sm">Pages</h3>
                <Badge variant="outline">{chunks.length}</Badge>
              </div>

              {chunksLoading ? (
                <div className="flex min-h-[120px] items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : chunks.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 bg-background/50 px-3 py-4 text-center text-muted-foreground text-xs">
                  No parsed pages yet.
                </div>
              ) : (
                <div className="max-h-[calc(100vh-220px)] space-y-1 overflow-y-auto pr-1">
                  {chunks.map((chunk) => {
                    const isActive = chunk.id === selectedChunkId;
                    return (
                      <button
                        className={cn(
                          "w-full rounded-lg border px-3 py-2 text-left transition",
                          isActive
                            ? "border-ring/45 bg-ring/10"
                            : "border-border/65 bg-background/55 hover:border-ring/35 hover:bg-ring/5"
                        )}
                        key={chunk.id}
                        onClick={() => onChunkSelect(chunk.id)}
                        type="button"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-xs">
                            Page{" "}
                            {typeof chunk.pageIndex === "number"
                              ? chunk.pageIndex + 1
                              : chunk.chunkIndex + 1}
                          </span>
                          <BookOpenText className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <p className="mt-1 line-clamp-2 text-muted-foreground text-xs leading-5">
                          {chunk.snippet}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </aside>

            <div className="min-h-0 overflow-auto px-5 py-4">
              {selectedDocId ? (
                <DriveDocumentViewer
                  chunkId={selectedChunkId}
                  className="min-h-[650px]"
                  organizationId={organizationId}
                  quote={highlightQuote}
                />
              ) : (
                <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed border-border/70 bg-background/45 text-muted-foreground text-sm">
                  Select a file to open the reading mode.
                </div>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
