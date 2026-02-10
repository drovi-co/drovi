// =============================================================================
// SMART DRIVE
// =============================================================================
//
// Pilot-grade document ingestion + evidence-first viewing.
//
// Phase 9/10 surface:
// - Upload manager (multipart)
// - Drive browser
// - Semantic search + "Ask this folder"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  FileUp,
  Folder,
  Loader2,
  Search,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { DriveDocumentViewer } from "@/components/drive/document-viewer";
import { DriveUploadManager } from "@/components/drive/upload-manager";
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/i18n";
import {
  type DriveDocument,
  type DriveDocumentChunk,
  type DriveSearchHit,
  documentsAPI,
} from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useDriveUploadsStore } from "@/lib/drive-uploads";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  tab: z.enum(["browse", "search", "ask"]).optional(),
  doc: z.string().optional(),
  chunk: z.string().optional(),
  quote: z.string().optional(),
  folder: z.string().optional(),
  tags: z.string().optional(),
});

export const Route = createFileRoute("/dashboard/drive")({
  component: DrivePage,
  validateSearch: searchSchema,
});

function statusBadge(
  status: string,
  t: (
    key: string,
    params?: Record<string, string | number | boolean | null | undefined>
  ) => string
) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "processed") {
    return (
      <Badge
        className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
        variant="outline"
      >
        {t("drive.status.processed")}
      </Badge>
    );
  }
  if (normalized === "processing") {
    return (
      <Badge
        className="border-amber-500/30 bg-amber-500/10 text-amber-700"
        variant="outline"
      >
        {t("drive.status.processing")}
      </Badge>
    );
  }
  if (normalized === "uploaded" || normalized === "uploading") {
    return (
      <Badge
        className="border-sky-500/30 bg-sky-500/10 text-sky-700"
        variant="outline"
      >
        {t("drive.status.uploading")}
      </Badge>
    );
  }
  if (normalized === "failed") {
    return (
      <Badge
        className="border-red-500/30 bg-red-500/10 text-red-600"
        variant="outline"
      >
        {t("drive.status.failed")}
      </Badge>
    );
  }
  return (
    <Badge
      className="border-muted bg-muted/30 text-muted-foreground"
      variant="outline"
    >
      {status || t("drive.status.unknown")}
    </Badge>
  );
}

type FolderNode = {
  name: string;
  path: string;
  count: number;
  children: FolderNode[];
};

function normalizeFolderPath(input: string | null | undefined): string {
  const raw = (input || "/").trim();
  if (!raw) return "/";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  if (withLeadingSlash === "/") return "/";
  const trimmed = withLeadingSlash.replace(/\/+$/g, "");
  return trimmed || "/";
}

function matchesFolderPrefix(folderPath: string, prefix: string): boolean {
  const f = normalizeFolderPath(folderPath);
  const p = normalizeFolderPath(prefix);
  if (p === "/") return true;
  if (f === p) return true;
  return f.startsWith(`${p}/`);
}

function parseTagsParam(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function encodeTagsParam(tags: string[]): string | undefined {
  const cleaned = (tags ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (cleaned.length === 0) return undefined;
  return cleaned.join(",");
}

function buildFolderTree(docFolders: string[]): FolderNode {
  const normalizedDocFolders = docFolders.map((p) => normalizeFolderPath(p));
  const uniqueFolders = Array.from(new Set(normalizedDocFolders)).sort();

  const counts = new Map<string, number>();
  for (const folder of normalizedDocFolders) {
    // Count per folder and ancestors so the tree reflects total docs under each prefix.
    const parts = folder.split("/").filter(Boolean);
    let current = "/";
    counts.set("/", (counts.get("/") ?? 0) + 1);
    for (const part of parts) {
      current = current === "/" ? `/${part}` : `${current}/${part}`;
      counts.set(current, (counts.get(current) ?? 0) + 1);
    }
  }

  const root: FolderNode = {
    name: "/",
    path: "/",
    count: counts.get("/") ?? 0,
    children: [],
  };
  const nodes = new Map<string, FolderNode>([["/", root]]);

  for (const folder of uniqueFolders) {
    const parts = folder.split("/").filter(Boolean);
    let parent = root;
    let current = "/";
    for (const part of parts) {
      current = current === "/" ? `/${part}` : `${current}/${part}`;
      let node = nodes.get(current);
      if (!node) {
        node = {
          name: part,
          path: current,
          count: counts.get(current) ?? 0,
          children: [],
        };
        nodes.set(current, node);
        parent.children.push(node);
      }
      parent = node;
    }
  }

  const sortTree = (node: FolderNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of node.children) sortTree(child);
  };
  sortTree(root);

  return root;
}

function DrivePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const t = useT();

  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  const tab = search.tab ?? "browse";
  const [activeTab, setActiveTab] = useState<typeof tab>(tab);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(
    search.doc ?? null
  );
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(
    search.chunk ?? null
  );
  const [highlightQuote, setHighlightQuote] = useState<string | null>(
    search.quote ?? null
  );
  const [folderPrefix, setFolderPrefix] = useState<string>(
    search.folder ?? "/"
  );
  const [selectedTags, setSelectedTags] = useState<string[]>(() =>
    parseTagsParam(search.tags)
  );

  useEffect(() => {
    setActiveTab(tab);
  }, [tab]);
  useEffect(() => setSelectedDocId(search.doc ?? null), [search.doc]);
  useEffect(() => setSelectedChunkId(search.chunk ?? null), [search.chunk]);
  useEffect(() => setHighlightQuote(search.quote ?? null), [search.quote]);
  useEffect(() => setFolderPrefix(search.folder ?? "/"), [search.folder]);
  useEffect(() => setSelectedTags(parseTagsParam(search.tags)), [search.tags]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const enqueueFiles = useDriveUploadsStore((s) => s.enqueueFiles);

  const docsQuery = useQuery({
    queryKey: ["drive-documents", organizationId],
    queryFn: async () => {
      const raw = await documentsAPI.list({ organizationId, limit: 200 });
      return raw.items;
    },
    enabled: Boolean(organizationId),
    refetchInterval: 3000,
  });

  const documents = (docsQuery.data ?? []) as DriveDocument[];

  const normalizedFolderPrefix = useMemo(
    () => normalizeFolderPath(folderPrefix),
    [folderPrefix]
  );

  const scopedDocuments = useMemo(() => {
    const tags = selectedTags.map((t) => t.toLowerCase());
    const hasTagFilter = tags.length > 0;
    return documents.filter((d) => {
      if (!matchesFolderPrefix(d.folderPath, normalizedFolderPrefix))
        return false;
      if (!hasTagFilter) return true;
      const docTags = (d.tags ?? []).map((t) => String(t).toLowerCase());
      return docTags.some((t) => tags.includes(t));
    });
  }, [documents, normalizedFolderPrefix, selectedTags]);

  const folderTree = useMemo(
    () => buildFolderTree(documents.map((d) => d.folderPath)),
    [documents]
  );
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const d of documents) {
      for (const tag of d.tags ?? []) {
        const cleaned = String(tag || "").trim();
        if (cleaned) set.add(cleaned);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [documents]);

  const [expandedFolders, setExpandedFolders] = useState<
    Record<string, boolean>
  >(() => ({ "/": true }));

  const setScopeFolder = (next: string) => {
    const normalized = normalizeFolderPath(next);
    setFolderPrefix(normalized);
    navigate({
      to: "/dashboard/drive",
      search: (prev) => ({
        ...prev,
        folder: normalized === "/" ? undefined : normalized,
      }),
    });
  };

  const resetScope = () => {
    setFolderPrefix("/");
    setSelectedTags([]);
    navigate({
      to: "/dashboard/drive",
      search: (prev) => ({
        ...prev,
        folder: undefined,
        tags: undefined,
      }),
    });
  };

  const toggleScopeTag = (tag: string) => {
    const cleaned = String(tag || "").trim();
    if (!cleaned) return;
    setSelectedTags((prev) => {
      const exists = prev.some(
        (t) => t.toLowerCase() === cleaned.toLowerCase()
      );
      const next = exists
        ? prev.filter((t) => t.toLowerCase() !== cleaned.toLowerCase())
        : [...prev, cleaned];
      navigate({
        to: "/dashboard/drive",
        search: (prevSearch) => ({
          ...prevSearch,
          tags: encodeTagsParam(next),
        }),
      });
      return next;
    });
  };

  const selectedDoc = useMemo(
    () => documents.find((d) => d.id === selectedDocId) ?? null,
    [documents, selectedDocId]
  );

  const chunksQuery = useQuery({
    queryKey: ["drive-chunks", organizationId, selectedDocId],
    queryFn: async () => {
      if (!selectedDocId) return [];
      const raw = await documentsAPI.listChunks({
        organizationId,
        documentId: selectedDocId,
        limit: 10_000,
      });
      return raw.items;
    },
    enabled: Boolean(organizationId && selectedDocId),
  });

  const chunks = (chunksQuery.data ?? []) as DriveDocumentChunk[];

  const docArtifactQuery = useQuery({
    queryKey: [
      "drive-doc-artifact",
      organizationId,
      selectedDoc?.evidenceArtifactId,
    ],
    queryFn: () =>
      documentsAPI.getEvidenceArtifact({
        organizationId,
        artifactId: selectedDoc?.evidenceArtifactId as string,
        includeUrl: true,
      }),
    enabled: Boolean(organizationId && selectedDoc?.evidenceArtifactId),
  });

  const searchMutation = useMutation({
    mutationFn: (query: string) =>
      documentsAPI.search({ query, organizationId, folderPrefix, limit: 25 }),
  });

  const askMutation = useMutation({
    mutationFn: (question: string) =>
      documentsAPI.ask({ question, organizationId, folderPrefix, limit: 8 }),
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [askQuestion, setAskQuestion] = useState("");

  const searchResults = searchMutation.data?.results ?? [];
  const askResult = askMutation.data ?? null;

  const onSelectDocument = (docId: string) => {
    setSelectedDocId(docId);
    setSelectedChunkId(null);
    setHighlightQuote(null);
    navigate({
      to: "/dashboard/drive",
      search: (prev) => ({
        ...prev,
        doc: docId,
        chunk: undefined,
        quote: undefined,
        tab: "browse",
      }),
    });
  };

  const onSelectChunk = (chunkId: string, quote?: string | null) => {
    setSelectedChunkId(chunkId);
    setHighlightQuote(quote ?? null);
    navigate({
      to: "/dashboard/drive",
      search: (prev) => ({
        ...prev,
        doc: selectedDocId ?? prev.doc,
        chunk: chunkId,
        quote: quote ?? undefined,
      }),
    });
  };

  const renderFolderNode = (node: FolderNode, depth: number) => {
    const isSelected = normalizeFolderPath(folderPrefix) === node.path;
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedFolders[node.path] ?? depth < 1;

    return (
      <div key={node.path}>
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-sm transition-colors",
            "hover:bg-muted/30",
            isSelected ? "border-primary/40 bg-primary/5" : "bg-card"
          )}
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          {hasChildren ? (
            <button
              aria-label={
                isExpanded
                  ? t("drive.scope.collapseFolder")
                  : t("drive.scope.expandFolder")
              }
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              onClick={() =>
                setExpandedFolders((prev) => ({
                  ...prev,
                  [node.path]: !isExpanded,
                }))
              }
              type="button"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <div className="h-7 w-7" />
          )}

          <button
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left"
            onClick={() => setScopeFolder(node.path)}
            type="button"
          >
            <Folder className="h-4 w-4 text-muted-foreground" />
            <span className="truncate">
              {node.path === "/" ? t("drive.scope.allDocuments") : node.name}
            </span>
          </button>

          <div className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
            {node.count}
          </div>
        </div>

        {hasChildren && isExpanded ? (
          <div className="mt-1 space-y-1">
            {node.children.map((child) => renderFolderNode(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  };

  if (orgLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {t("drive.header.selectOrg")}
      </div>
    );
  }

  if (docsQuery.isError) {
    return (
      <div
        className="flex h-full flex-col justify-center p-6"
        data-no-shell-padding
      >
        <ApiErrorPanel
          error={docsQuery.error}
          onRetry={() => docsQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6" data-no-shell-padding>
      <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.2em]">
              <Folder className="h-3 w-3" />
              {t("drive.header.kicker")}
            </div>
            <h1 className="font-semibold text-2xl">
              {t("drive.header.title")}
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              {t("drive.header.description")}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Input
              className="h-9 w-[240px]"
              onBlur={() => setScopeFolder(folderPrefix)}
              onChange={(e) => setFolderPrefix(e.target.value || "/")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setScopeFolder(folderPrefix);
                }
              }}
              placeholder={t("drive.header.folderPlaceholder")}
              value={folderPrefix}
            />
            <input
              className="hidden"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length === 0) return;
                enqueueFiles(files, organizationId, {
                  folderPath: normalizedFolderPrefix,
                  tags: selectedTags,
                });
                toast.success(
                  files.length === 1
                    ? t("drive.header.queuedUploadsOne", {
                        count: files.length,
                      })
                    : t("drive.header.queuedUploadsMany", {
                        count: files.length,
                      })
                );
                e.currentTarget.value = "";
              }}
              ref={fileInputRef}
              type="file"
            />
            <Button onClick={() => fileInputRef.current?.click()} size="sm">
              <FileUp className="mr-2 h-4 w-4" />
              {t("drive.header.uploadFiles")}
            </Button>
          </div>
        </div>
      </div>

      <Tabs
        onValueChange={(value) => {
          const next = value as "browse" | "search" | "ask";
          setActiveTab(next);
          navigate({
            to: "/dashboard/drive",
            search: (prev) => ({ ...prev, tab: next }),
          });
        }}
        value={activeTab}
      >
        <TabsList>
          <TabsTrigger value="browse">{t("drive.tabs.browse")}</TabsTrigger>
          <TabsTrigger value="search">{t("drive.tabs.search")}</TabsTrigger>
          <TabsTrigger value="ask">{t("drive.tabs.ask")}</TabsTrigger>
        </TabsList>

        <TabsContent className="mt-6" value="browse">
          <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
            <div className="space-y-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {t("drive.scope.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("drive.scope.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                      <Folder className="h-3.5 w-3.5" />
                      <span className="font-medium text-foreground">
                        {normalizedFolderPrefix}
                      </span>
                      {selectedTags.length ? (
                        <span className="inline-flex items-center gap-1 rounded-full border bg-muted/20 px-2 py-0.5">
                          <Tag className="h-3.5 w-3.5" />
                          {selectedTags.length === 1
                            ? t("drive.scope.tagsCountOne", {
                                count: selectedTags.length,
                              })
                            : t("drive.scope.tagsCountMany", {
                                count: selectedTags.length,
                              })}
                        </span>
                      ) : null}
                    </div>

                    {normalizedFolderPrefix !== "/" || selectedTags.length ? (
                      <Button onClick={resetScope} size="sm" variant="outline">
                        <X className="mr-2 h-4 w-4" />
                        {t("drive.scope.clear")}
                      </Button>
                    ) : null}
                  </div>

                  <div className="grid gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs">
                        <Folder className="h-3.5 w-3.5" />
                        {t("drive.scope.folders")}
                      </div>
                      {documents.length === 0 ? (
                        <div className="rounded-xl border border-dashed bg-muted/20 p-4 text-center text-muted-foreground text-sm">
                          {t("drive.scope.noDocuments")}
                        </div>
                      ) : (
                        <div className="max-h-[240px] space-y-1 overflow-auto pr-1">
                          {renderFolderNode(folderTree, 0)}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs">
                        <Tag className="h-3.5 w-3.5" />
                        {t("drive.scope.tags")}
                      </div>
                      {allTags.length === 0 ? (
                        <div className="rounded-xl border border-dashed bg-muted/20 p-4 text-center text-muted-foreground text-sm">
                          {t("drive.scope.noTags")}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {allTags.map((t) => {
                            const selected = selectedTags.some(
                              (s) => s.toLowerCase() === t.toLowerCase()
                            );
                            return (
                              <button
                                key={t}
                                onClick={() => toggleScopeTag(t)}
                                type="button"
                              >
                                <Badge
                                  className={cn(
                                    "cursor-pointer select-none px-2 py-0.5 text-xs",
                                    selected
                                      ? "bg-primary text-primary-foreground"
                                      : ""
                                  )}
                                  variant={selected ? "default" : "outline"}
                                >
                                  {t}
                                </Badge>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    {t("drive.library.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("drive.library.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {docsQuery.isLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : scopedDocuments.length === 0 ? (
                    <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-muted-foreground text-sm">
                      {t("drive.library.emptyScoped")}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {scopedDocuments.map((doc) => (
                        <button
                          className={cn(
                            "w-full rounded-xl border px-3 py-3 text-left transition-colors",
                            "hover:bg-muted/30",
                            selectedDocId === doc.id
                              ? "border-primary/40 bg-primary/5"
                              : "bg-card"
                          )}
                          key={doc.id}
                          onClick={() => onSelectDocument(doc.id)}
                          type="button"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate font-medium text-sm">
                                {doc.title || doc.fileName}
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
                                <span className="truncate">{doc.fileName}</span>
                                {doc.pageCount != null ? (
                                  <span>
                                    ·{" "}
                                    {doc.pageCount === 1
                                      ? t("drive.pages.pagesCountOne", {
                                          count: doc.pageCount,
                                        })
                                      : t("drive.pages.pagesCountMany", {
                                          count: doc.pageCount,
                                        })}
                                  </span>
                                ) : null}
                                <span>· {doc.folderPath}</span>
                              </div>
                            </div>
                            <div className="shrink-0">
                              {statusBadge(doc.status, t)}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <DriveUploadManager organizationId={organizationId} />
            </div>

            <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
              <Card className="h-fit">
                <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base">
                      {t("drive.pages.title")}
                    </CardTitle>
                    <CardDescription>
                      {t("drive.pages.description")}
                    </CardDescription>
                  </div>
                  {docArtifactQuery.data?.presigned_url ? (
                    <Button asChild size="sm" variant="outline">
                      <a
                        href={docArtifactQuery.data.presigned_url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {t("drive.pages.openPdf")}
                      </a>
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-2">
                  {selectedDocId ? (
                    chunksQuery.isLoading ? (
                      <div className="flex items-center justify-center py-10">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : chunks.length === 0 ? (
                      <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-muted-foreground text-sm">
                        {t("drive.pages.noParsedPages")}
                      </div>
                    ) : (
                      <div className="max-h-[70vh] space-y-2 overflow-auto pr-1">
                        {chunks.map((c) => (
                          <button
                            className={cn(
                              "w-full rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/30",
                              selectedChunkId === c.id
                                ? "border-primary/40 bg-primary/5"
                                : "bg-card"
                            )}
                            key={c.id}
                            onClick={() => onSelectChunk(c.id)}
                            type="button"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="font-medium text-xs">
                                  {c.pageIndex != null
                                    ? `${t("drive.pages.page")} ${c.pageIndex + 1}`
                                    : `${t("drive.pages.chunk")} ${c.chunkIndex}`}
                                </div>
                                <div className="mt-1 line-clamp-2 text-muted-foreground text-xs">
                                  {c.snippet}
                                </div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )
                  ) : (
                    <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-muted-foreground text-sm">
                      {t("drive.pages.selectDocument")}
                    </div>
                  )}
                </CardContent>
              </Card>

              <DriveDocumentViewer
                chunkId={selectedChunkId}
                className="min-h-[420px]"
                organizationId={organizationId}
                quote={highlightQuote}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent className="mt-6" value="search">
          <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Search className="h-4 w-4 text-primary" />
                  {t("drive.search.title")}
                </CardTitle>
                <CardDescription>
                  {t("drive.search.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t("drive.search.placeholder")}
                    value={searchQuery}
                  />
                  <Button
                    disabled={
                      searchMutation.isPending || searchQuery.trim().length < 2
                    }
                    onClick={() => searchMutation.mutate(searchQuery.trim())}
                  >
                    {searchMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t("drive.search.button")
                    )}
                  </Button>
                </div>

                {searchMutation.isError ? (
                  <ApiErrorPanel
                    error={searchMutation.error}
                    onRetry={() => searchMutation.mutate(searchQuery.trim())}
                  />
                ) : null}

                {searchResults.length === 0 ? (
                  <div className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-muted-foreground text-sm">
                    {t("drive.search.noResults")}
                  </div>
                ) : (
                  <div className="max-h-[70vh] space-y-2 overflow-auto pr-1">
                    {searchResults.map((hit) => (
                      <button
                        className="w-full rounded-xl border bg-card px-3 py-3 text-left transition-colors hover:bg-muted/30"
                        key={hit.chunk_id}
                        onClick={() => {
                          setSelectedDocId(hit.document_id);
                          onSelectChunk(hit.chunk_id, searchQuery.trim());
                        }}
                        type="button"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-sm">
                              {hit.title || hit.file_name}
                            </div>
                            <div className="mt-1 text-muted-foreground text-xs">
                              {hit.page_index != null
                                ? `${t("drive.pages.page")} ${hit.page_index + 1}`
                                : t("drive.search.chunk")}{" "}
                              · {hit.folder_path}
                            </div>
                            <div className="mt-2 line-clamp-3 text-muted-foreground text-xs">
                              {hit.snippet}
                            </div>
                          </div>
                          <div className="shrink-0">
                            {/* Score placeholder */}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <DriveDocumentViewer
              chunkId={selectedChunkId}
              className="min-h-[420px]"
              organizationId={organizationId}
              quote={highlightQuote}
            />
          </div>
        </TabsContent>

        <TabsContent className="mt-6" value="ask">
          <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4 text-primary" />
                  {t("drive.ask.title")}
                </CardTitle>
                <CardDescription>{t("drive.ask.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    onChange={(e) => setAskQuestion(e.target.value)}
                    placeholder={t("drive.ask.placeholder")}
                    value={askQuestion}
                  />
                  <Button
                    disabled={
                      askMutation.isPending || askQuestion.trim().length < 3
                    }
                    onClick={() => askMutation.mutate(askQuestion.trim())}
                  >
                    {askMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t("drive.ask.button")
                    )}
                  </Button>
                </div>

                {askMutation.isError ? (
                  <ApiErrorPanel
                    error={askMutation.error}
                    onRetry={() => askMutation.mutate(askQuestion.trim())}
                  />
                ) : null}

                <div className="rounded-xl border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-muted-foreground text-xs">
                      {t("drive.ask.answer")}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        disabled={!askResult?.answer}
                        onClick={async () => {
                          const text = askResult?.answer || "";
                          if (!text) return;
                          await navigator.clipboard.writeText(text);
                          toast.success(t("drive.ask.copiedAnswer"));
                        }}
                        size="sm"
                        variant="outline"
                      >
                        {t("drive.ask.copy")}
                      </Button>
                      <Button
                        disabled={!askResult?.answer}
                        onClick={async () => {
                          const sources = askResult?.sources ?? [];
                          const md = [
                            "# Drive Brief",
                            "",
                            `**Folder:** ${normalizedFolderPrefix}`,
                            selectedTags.length
                              ? `**Tags:** ${selectedTags.join(", ")}`
                              : null,
                            "",
                            "## Question",
                            askQuestion.trim() || "(not provided)",
                            "",
                            "## Answer",
                            askResult?.answer || "",
                            "",
                            "## Sources",
                            sources.length
                              ? sources
                                  .map((s, i) => {
                                    const page =
                                      s.page_index != null
                                        ? `page ${s.page_index + 1}`
                                        : "chunk";
                                    const title = s.title || s.file_name;
                                    return `- [${i + 1}] ${title} (${page}) · ${s.folder_path} · chunk ${s.chunk_id}`;
                                  })
                                  .join("\n")
                              : "- (none)",
                          ]
                            .filter(
                              (line): line is string => typeof line === "string"
                            )
                            .join("\n");
                          await navigator.clipboard.writeText(md);
                          toast.success(t("drive.ask.copiedBrief"));
                        }}
                        size="sm"
                        variant="outline"
                      >
                        {t("drive.ask.copyBrief")}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                    {askResult ? askResult.answer : t("drive.ask.emptyAnswer")}
                  </div>
                </div>

                {askResult?.sources?.length ? (
                  <div className="space-y-2">
                    <div className="text-muted-foreground text-xs">
                      {t("drive.ask.sources")}
                    </div>
                    {askResult.sources.map((s: DriveSearchHit, idx: number) => (
                      <button
                        className="w-full rounded-xl border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/30"
                        key={`${s.chunk_id}-${idx}`}
                        onClick={() => {
                          setSelectedDocId(s.document_id);
                          onSelectChunk(s.chunk_id, s.snippet);
                        }}
                        type="button"
                      >
                        <div className="truncate font-medium text-xs">
                          [{idx + 1}] {s.title || s.file_name}
                        </div>
                        <div className="mt-1 text-muted-foreground text-xs">
                          {s.page_index != null
                            ? `${t("drive.pages.page")} ${s.page_index + 1}`
                            : t("drive.pages.chunk")}{" "}
                          · {s.folder_path}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <DriveDocumentViewer
              chunkId={selectedChunkId}
              className="min-h-[420px]"
              organizationId={organizationId}
              quote={highlightQuote}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
