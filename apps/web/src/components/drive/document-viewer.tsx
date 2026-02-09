import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ExternalLink, Loader2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/i18n";
import { documentsAPI, type DriveDocumentChunkDetail, type EvidenceArtifact } from "@/lib/api";
import { cn } from "@/lib/utils";

type HighlightBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  text?: string;
  score: number;
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, "\"")
    .trim();
}

function pickHighlightBoxes(
  chunk: DriveDocumentChunkDetail,
  quote: string | null | undefined
): HighlightBox[] {
  const rawQuote = quote ? normalizeText(quote) : "";
  const blocks = (chunk.layoutBlocks ?? []) as Array<Record<string, unknown>>;

  if (!rawQuote) {
    return [];
  }

  const tokens = rawQuote
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 4)
    .slice(0, 14);

  const fullMatch: HighlightBox[] = [];
  const scored: HighlightBox[] = [];

  for (const b of blocks) {
    const text = typeof b.text === "string" ? b.text : "";
    const normalized = normalizeText(text);
    if (!normalized) continue;

    const left = Number(b.left ?? 0);
    const top = Number(b.top ?? 0);
    const width = Number(b.width ?? 0);
    const height = Number(b.height ?? 0);

    if (normalized.includes(rawQuote) && rawQuote.length >= 16) {
      fullMatch.push({
        left,
        top,
        width,
        height,
        text,
        score: 100,
      });
      continue;
    }

    let score = 0;
    for (const tok of tokens) {
      if (normalized.includes(tok.toLowerCase())) {
        score += 1;
      }
    }
    if (score > 0) {
      scored.push({
        left,
        top,
        width,
        height,
        text,
        score,
      });
    }
  }

  if (fullMatch.length > 0) {
    return fullMatch.slice(0, 8);
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 10);
}

export function DriveDocumentViewer({
  organizationId,
  chunkId,
  quote,
  className,
}: {
  organizationId: string;
  chunkId: string | null;
  quote?: string | null;
  className?: string;
}) {
  const t = useT();
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [rendered, setRendered] = useState<{ w: number; h: number } | null>(null);

  const chunkQuery = useQuery({
    queryKey: ["drive-chunk", organizationId, chunkId],
    queryFn: () => documentsAPI.getChunk({ chunkId: chunkId as string, organizationId }),
    enabled: Boolean(organizationId && chunkId),
  });

  const chunk = chunkQuery.data ?? null;

  const artifactQuery = useQuery({
    queryKey: ["drive-chunk-artifact", organizationId, chunk?.imageArtifactId],
    queryFn: () =>
      documentsAPI.getEvidenceArtifact({
        organizationId,
        artifactId: chunk?.imageArtifactId as string,
        includeUrl: true,
      }),
    enabled: Boolean(organizationId && chunk?.imageArtifactId),
  });

  const artifact: EvidenceArtifact | null = artifactQuery.data ?? null;
  const imageUrl = artifact?.presigned_url ?? null;

  const boxes = useMemo(() => {
    if (!chunk) return [];
    return pickHighlightBoxes(chunk, quote);
  }, [chunk, quote]);

  const scale = useMemo(() => {
    if (!natural || !rendered || natural.w <= 0) return 1;
    return rendered.w / natural.w;
  }, [natural, rendered]);

  if (!chunkId) {
    return (
      <Card className={cn("h-full", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("drive.viewer.title")}</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {t("drive.viewer.selectPrompt")}
        </CardContent>
      </Card>
    );
  }

  if (chunkQuery.isError) {
    return (
      <Card className={cn("h-full", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("drive.viewer.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ApiErrorPanel error={chunkQuery.error} onRetry={() => chunkQuery.refetch()} />
        </CardContent>
      </Card>
    );
  }

  if (chunkQuery.isLoading || !chunk) {
    return (
      <Card className={cn("h-full", className)}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("drive.viewer.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("h-full", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <CardTitle className="truncate text-base">{t("drive.viewer.pagePreview")}</CardTitle>
          <div className="mt-1 text-muted-foreground text-xs">
            {t("drive.pages.chunk")} {chunk.chunkIndex}
            {chunk.pageIndex != null ? ` · ${t("drive.pages.page")} ${chunk.pageIndex + 1}` : ""}
          </div>
        </div>
        {imageUrl ? (
          <Button asChild size="sm" variant="outline">
            <a href={imageUrl} rel="noreferrer" target="_blank">
              <ExternalLink className="mr-2 h-4 w-4" />
              {t("drive.viewer.open")}
            </a>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {chunk.imageArtifactId && !imageUrl ? (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-muted-foreground text-xs">
            {artifactQuery.isError ? <AlertCircle className="h-4 w-4 text-destructive" /> : <Loader2 className="h-4 w-4 animate-spin" />}
            <span>
              {artifactQuery.isError
                ? t("drive.viewer.failedPageImage")
                : t("drive.viewer.loadingPageImage")}
            </span>
          </div>
        ) : null}

        {imageUrl ? (
          <div
            className="relative overflow-hidden rounded-xl border bg-background"
            style={{ maxHeight: "70vh" }}
          >
            <img
              alt={t("drive.viewer.pageAlt")}
              className="block h-auto w-full"
              onLoad={() => {
                const el = imgRef.current;
                if (!el) return;
                setNatural({ w: el.naturalWidth, h: el.naturalHeight });
                setRendered({ w: el.clientWidth, h: el.clientHeight });
              }}
              ref={imgRef}
              src={imageUrl}
            />

            {/* Highlight overlay */}
            {boxes.length > 0 && natural ? (
              <div className="pointer-events-none absolute inset-0">
                {boxes.map((b, idx) => (
                  <div
                    className="absolute rounded-md bg-amber-400/20 ring-1 ring-amber-500/40"
                    key={`${idx}-${b.left}-${b.top}`}
                    style={{
                      left: Math.max(b.left * scale, 0),
                      top: Math.max(b.top * scale, 0),
                      width: Math.max(b.width * scale, 6),
                      height: Math.max(b.height * scale, 6),
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="text-muted-foreground text-xs">{t("drive.viewer.textPreview")}</div>
            <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
              {chunk.text}
            </div>
          </div>
        )}

        {quote ? (
          <div className="rounded-xl border bg-amber-50/60 px-3 py-2 text-amber-900 text-xs dark:bg-amber-500/10 dark:text-amber-200">
            <span className="font-medium">{t("drive.viewer.evidenceQuote")}</span>{" "}
            <span className="italic">"{quote}"</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
