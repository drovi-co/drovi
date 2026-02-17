import { Badge } from "@memorystack/ui-core/badge";
import { Button } from "@memorystack/ui-core/button";
import { Input } from "@memorystack/ui-core/input";
import { useDriveSelectionState } from "@memorystack/mod-drive";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  FileUp,
  Folder,
  FolderOpen,
  Loader2,
  Search,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DriveUploadManager } from "@/components/drive/upload-manager";
import { ApiErrorPanel } from "@/components/layout/api-error-panel";
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
import { DriveReadingSheet } from "../components/drive-reading-sheet";
import {
  buildFolderTree,
  fileDisplayTitle,
  fileTypeLabel,
  findFolderNode,
  folderParent,
  formatBytes,
  formatDate,
  matchesFolderPrefix,
  normalizeFolderPath,
  sameFolder,
  statusBadge,
} from "./drive-page-helpers";

export function DrivePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = useSearch({ from: "/dashboard/drive" });
  const t = useT();

  const { data: activeOrg, isPending: orgLoading } =
    authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  const {
    folderPrefix,
    selectedDocId,
    selectedChunkId,
    highlightQuote,
    searchMode,
    searchText,
    readerOpen,
    setSelectedChunkId,
    setReaderOpen,
    setSearchMode,
    setSearchText,
    selectChunk,
    selectFolder: applyFolderSelection,
    openDocument: applyDocumentSelection,
    closeReader: closeDocumentSelection,
  } = useDriveSelectionState({
    folder: search.folder,
    doc: search.doc,
    chunk: search.chunk,
    quote: search.quote,
  });
  const [docStreamConnected, setDocStreamConnected] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const enqueueFiles = useDriveUploadsStore((state) => state.enqueueFiles);

  const applyDocumentEvent = useCallback(
    (payload: unknown) => {
      if (!organizationId) return;
      if (!payload || typeof payload !== "object") return;
      const event = payload as Record<string, unknown>;
      const documentId = String(event.document_id ?? "");
      if (!documentId) return;

      const statusRaw = event.status;
      const status = typeof statusRaw === "string" ? statusRaw : null;
      const pageCountRaw = event.page_count;
      const pageCount = typeof pageCountRaw === "number" ? pageCountRaw : undefined;

      queryClient.setQueryData<DriveDocument[]>(
        ["drive-documents", organizationId],
        (current) => {
          const rows = current ?? [];
          const idx = rows.findIndex((doc) => doc.id === documentId);
          if (idx < 0) {
            queryClient.invalidateQueries({
              queryKey: ["drive-documents", organizationId],
              exact: true,
            });
            return rows;
          }

          const next = [...rows];
          const prev = rows[idx];
          next[idx] = {
            ...prev,
            status: status ?? prev.status,
            pageCount: pageCount ?? prev.pageCount,
          };
          return next;
        }
      );
    },
    [organizationId, queryClient]
  );

  useEffect(() => {
    if (!organizationId) {
      setDocStreamConnected(false);
      return;
    }

    const endpoint = `/api/v1/documents/events?organization_id=${encodeURIComponent(organizationId)}`;
    const stream = new EventSource(endpoint, { withCredentials: true });

    const onOpen = () => setDocStreamConnected(true);
    const onError = () => setDocStreamConnected(false);
    const onEvent = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as unknown;
        applyDocumentEvent(data);
      } catch {
        // Keep stream alive if one event payload is malformed.
      }
    };

    stream.addEventListener("uploaded", onEvent as EventListener);
    stream.addEventListener("processing", onEvent as EventListener);
    stream.addEventListener("processed", onEvent as EventListener);
    stream.addEventListener("failed", onEvent as EventListener);
    stream.onopen = onOpen;
    stream.onerror = onError;

    return () => {
      setDocStreamConnected(false);
      stream.close();
    };
  }, [organizationId, applyDocumentEvent]);

  const docsQuery = useQuery({
    queryKey: ["drive-documents", organizationId],
    queryFn: async () => {
      const raw = await documentsAPI.list({ organizationId, limit: 200 });
      return raw.items;
    },
    enabled: Boolean(organizationId),
    refetchInterval: docStreamConnected ? false : 3000,
  });

  const documents = (docsQuery.data ?? []) as DriveDocument[];
  const normalizedFolderPrefix = useMemo(
    () => normalizeFolderPath(folderPrefix),
    [folderPrefix]
  );

  const folderTree = useMemo(() => buildFolderTree(documents), [documents]);
  const activeFolderNode = useMemo(
    () => findFolderNode(folderTree, normalizedFolderPrefix),
    [folderTree, normalizedFolderPrefix]
  );
  const childFolders = activeFolderNode?.children ?? [];

  const filesInFolder = useMemo(() => {
    return documents
      .filter((doc) => sameFolder(doc.folderPath, normalizedFolderPrefix))
      .sort((a, b) => {
        const aTs = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bTs = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bTs - aTs;
      });
  }, [documents, normalizedFolderPrefix]);

  const documentsInScope = useMemo(() => {
    return documents.filter((doc) =>
      matchesFolderPrefix(doc.folderPath, normalizedFolderPrefix)
    ).length;
  }, [documents, normalizedFolderPrefix]);

  const selectedDoc = useMemo(
    () => documents.find((doc) => doc.id === selectedDocId) ?? null,
    [documents, selectedDocId]
  );

  const chunksQuery = useQuery({
    queryKey: ["drive-chunks", organizationId, selectedDocId],
    queryFn: async () => {
      if (!selectedDocId) return [];
      const raw = await documentsAPI.listChunks({
        documentId: selectedDocId,
        organizationId,
        limit: 200,
      });
      return raw.items;
    },
    enabled: Boolean(organizationId && selectedDocId),
  });

  const chunks = (chunksQuery.data ?? []) as DriveDocumentChunk[];

  useEffect(() => {
    if (!selectedDocId) return;
    if (selectedChunkId) return;
    if (!chunks.length) return;
    setSelectedChunkId(chunks[0].id);
  }, [selectedDocId, selectedChunkId, chunks]);

  const searchMutation = useMutation({
    mutationFn: (query: string) =>
      documentsAPI.search({
        query,
        organizationId,
        folderPrefix: normalizedFolderPrefix,
        limit: 25,
      }),
  });

  const askMutation = useMutation({
    mutationFn: (question: string) =>
      documentsAPI.ask({
        question,
        organizationId,
        folderPrefix: normalizedFolderPrefix,
        limit: 8,
      }),
  });

  const searchResults: DriveSearchHit[] =
    searchMode === "index"
      ? searchMutation.data?.results ?? []
      : askMutation.data?.sources ?? [];

  const aiAnswer = askMutation.data?.answer ?? "";

  const updateDriveSearch = useCallback(
    (next: {
      folder?: string | undefined;
      doc?: string | undefined;
      chunk?: string | undefined;
      quote?: string | undefined;
    }) => {
      navigate({
        to: "/dashboard/drive",
        search: (prev) => ({
          ...prev,
          folder: next.folder ?? prev.folder,
          doc: next.doc,
          chunk: next.chunk,
          quote: next.quote,
        }),
      });
    },
    [navigate]
  );

  const selectFolder = useCallback(
    (path: string) => {
      const normalized = normalizeFolderPath(path);
      applyFolderSelection(normalized);
      updateDriveSearch({
        folder: normalized,
        doc: undefined,
        chunk: undefined,
        quote: undefined,
      });
    },
    [applyFolderSelection, updateDriveSearch]
  );

  const openDocument = useCallback(
    (docId: string, options?: { chunkId?: string; quote?: string }) => {
      applyDocumentSelection(docId, options);
      updateDriveSearch({
        folder: normalizedFolderPrefix,
        doc: docId,
        chunk: options?.chunkId,
        quote: options?.quote,
      });
    },
    [applyDocumentSelection, normalizedFolderPrefix, updateDriveSearch]
  );

  const closeReader = useCallback(() => {
    closeDocumentSelection();
    updateDriveSearch({
      folder: normalizedFolderPrefix,
      doc: undefined,
      chunk: undefined,
      quote: undefined,
    });
  }, [closeDocumentSelection, normalizedFolderPrefix, updateDriveSearch]);

  const submitSearch = useCallback(() => {
    const query = searchText.trim();
    if (query.length < 2) {
      toast.error("Enter at least 2 characters");
      return;
    }
    if (searchMode === "index") {
      askMutation.reset();
      searchMutation.mutate(query);
      return;
    }
    searchMutation.reset();
    askMutation.mutate(query);
  }, [askMutation, searchMode, searchMutation, searchText]);

  const parentFolderPath = useMemo(
    () => folderParent(normalizedFolderPrefix),
    [normalizedFolderPrefix]
  );

  if (orgLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className="flex min-h-[360px] items-center justify-center p-8 text-center">
        <div className="space-y-2">
          <p className="font-medium">{t("drive.header.selectOrg")}</p>
        </div>
      </div>
    );
  }

  if (docsQuery.isError) {
    return (
      <div className="p-6">
        <ApiErrorPanel
          error={docsQuery.error}
          onRetry={() => docsQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full flex-col gap-4 overflow-hidden p-4 md:p-6"
      data-no-shell-padding
    >
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(70%_65%_at_0%_0%,rgba(176,138,75,0.2)_0%,transparent_72%),radial-gradient(70%_60%_at_100%_0%,rgba(23,52,38,0.45)_0%,transparent_75%)]" />

      <section className="rounded-xl border border-[#3a5a47] bg-[#112419]/95 px-4 py-4 md:px-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="old-money-kicker text-[10px]">Archive</span>
              <Badge
                className="border-[#b08a4b70] bg-[#b08a4b1f] text-[#e6cfaa]"
                variant="outline"
              >
                {docStreamConnected ? "live" : "polling"}
              </Badge>
            </div>
            <h1 className="mt-1 font-serif text-lg text-[#f3e8d2] md:text-xl">
              Drive
            </h1>
          </div>

          <input
            className="hidden"
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length === 0) return;
              enqueueFiles(files, organizationId, {
                folderPath: normalizedFolderPrefix,
                tags: [],
              });
              toast.success(
                files.length === 1
                  ? t("drive.header.queuedUploadsOne", { count: files.length })
                  : t("drive.header.queuedUploadsMany", {
                      count: files.length,
                    })
              );
              event.currentTarget.value = "";
            }}
            ref={fileInputRef}
            type="file"
          />
          <Button
            className="h-10 border border-[#b08a4b85] bg-[#b08a4b] px-4 text-[#102217] hover:bg-[#c7a868]"
            onClick={() => fileInputRef.current?.click()}
            size="sm"
          >
            <FileUp className="mr-2 h-4 w-4" />
            {t("drive.header.uploadFiles")}
          </Button>
        </div>

        <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <Button
              className={cn(
                "h-8 rounded-md border px-3 text-xs",
                searchMode === "index"
                  ? "border-[#b08a4b8a] bg-[#b08a4b29] text-[#f1dfbf]"
                  : "border-[#2f4a3a] bg-[#13281e] text-[#b9ad95]"
              )}
              onClick={() => setSearchMode("index")}
              size="sm"
              variant="ghost"
            >
              <Search className="mr-1.5 h-3.5 w-3.5" />
              Search
            </Button>
            <Button
              className={cn(
                "h-8 rounded-md border px-3 text-xs",
                searchMode === "ai"
                  ? "border-[#b08a4b8a] bg-[#b08a4b29] text-[#f1dfbf]"
                  : "border-[#2f4a3a] bg-[#13281e] text-[#b9ad95]"
              )}
              onClick={() => setSearchMode("ai")}
              size="sm"
              variant="ghost"
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              AI
            </Button>
          </div>

          <div className="flex flex-1 gap-2">
            <Input
              className="h-10 border-[#345240] bg-[#0f1f17] text-[#f3e8d2] placeholder:text-[#8f846f]"
              onChange={(event) => setSearchText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitSearch();
              }}
              placeholder={
                searchMode === "index"
                  ? "Search files in this folder"
                  : "Ask with evidence"
              }
              value={searchText}
            />
            <Button
              className="h-10 border border-[#b08a4b90] bg-[#b08a4b] px-4 text-[#102217] hover:bg-[#c6a160]"
              disabled={
                searchMode === "index"
                  ? searchMutation.isPending
                  : askMutation.isPending
              }
              onClick={submitSearch}
              size="sm"
            >
              {searchMode === "index" ? (
                searchMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )
              ) : askMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {parentFolderPath ? (
            <Button
              className="h-8 rounded-md border-[#365644] bg-[#12271d] text-[#e7d6b5] hover:bg-[#173224]"
              onClick={() => selectFolder(parentFolderPath)}
              size="sm"
              variant="outline"
            >
              <ChevronLeft className="mr-1.5 h-3.5 w-3.5" />
              Up
            </Button>
          ) : null}
          <span className="rounded-md border border-[#345341] bg-[#102116] px-2.5 py-1 font-mono text-[11px] text-[#ccb58e]">
            {normalizedFolderPrefix}
          </span>
          <span className="text-[#b8aa8d]">
            {documentsInScope} items in scope
          </span>
        </div>
      </section>

      {(searchMutation.isError || askMutation.isError) && (
        <ApiErrorPanel
          error={searchMode === "index" ? searchMutation.error : askMutation.error}
          onRetry={submitSearch}
        />
      )}

      {((searchMode === "ai" && aiAnswer) || searchResults.length > 0) && (
        <section className="rounded-xl border border-[#3f604b] bg-[#102318] px-4 py-4 md:px-5">
          {searchMode === "ai" && aiAnswer ? (
            <div className="rounded-lg border border-[#3d5d4a] bg-[#0f2018] px-3 py-3 text-[#e6d8be] text-sm leading-6">
              {aiAnswer}
            </div>
          ) : null}

          {searchResults.length > 0 ? (
            <div className="mt-3 grid gap-2">
              {searchResults.map((result, index) => (
                <button
                  className="group rounded-lg border border-[#3f604b] bg-[#102318] px-3 py-3 text-left transition hover:border-[#b08a4b78] hover:bg-[#142d21]"
                  key={`${result.chunk_id}-${index}`}
                  onClick={() =>
                    openDocument(result.document_id, {
                      chunkId: result.chunk_id,
                      quote: result.snippet,
                    })
                  }
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-[#f1e4ce] text-sm">
                        {result.title || result.file_name}
                      </p>
                      <p className="mt-1 text-[#b8ab90] text-xs">
                        {normalizeFolderPath(result.folder_path)}
                        {typeof result.page_index === "number"
                          ? ` · Page ${result.page_index + 1}`
                          : ""}
                      </p>
                    </div>
                    <ChevronRight className="mt-0.5 h-4 w-4 text-[#b8aa8b] transition group-hover:text-[#ead8b3]" />
                  </div>
                  <p className="mt-2 line-clamp-2 text-[#beb096] text-sm">
                    {result.snippet}
                  </p>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      )}

      <section className="rounded-xl border border-[#3f604b] bg-[#102318] px-4 py-4 md:px-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-base text-[#f3e7d1]">Folders</h2>
          <span className="text-[#b8ab90] text-xs">{childFolders.length}</span>
        </div>

        {childFolders.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#3e5d4b] bg-[#0f2118] px-4 py-8 text-center text-[#baa98b] text-sm">
            No subfolders in this folder.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {childFolders.map((folder) => (
              <button
                className="group rounded-lg border border-[#456650] bg-[#13291f] px-3 py-3 text-left transition hover:border-[#b08a4b80] hover:bg-[#183324]"
                key={folder.path}
                onClick={() => selectFolder(folder.path)}
                type="button"
              >
                <div className="flex items-center justify-between">
                  <FolderOpen className="h-4 w-4 text-[#d5b274]" />
                  <ChevronRight className="h-4 w-4 text-[#b9aa8c] transition group-hover:text-[#e7d5b3]" />
                </div>
                <p className="mt-2 truncate font-medium text-[#f3e7d1] text-sm">
                  {folder.name}
                </p>
                <p className="mt-1 text-[#b7a88b] text-xs">
                  {folder.count} file{folder.count === 1 ? "" : "s"}
                </p>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[#3f604b] bg-[#102318] px-4 py-4 md:px-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-base text-[#f3e7d1]">Files</h2>
          <Badge className="border-[#b08a4b75] bg-[#b08a4b1f] text-[#e7d2aa]" variant="outline">
            {filesInFolder.length} items
          </Badge>
        </div>

        {filesInFolder.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#3e5d4b] bg-[#0f2118] px-4 py-10 text-center text-[#baa98b] text-sm">
            No files in this folder.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {filesInFolder.map((doc) => (
              <button
                className="group rounded-lg border border-[#456650] bg-[#13291f] px-3 py-3 text-left transition hover:border-[#b08a4b80] hover:bg-[#183324]"
                key={doc.id}
                onClick={() => openDocument(doc.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-2">
                  <FileText className="h-4 w-4 text-[#d5b274]" />
                  {statusBadge(doc.status, t)}
                </div>
                <p className="mt-2 line-clamp-2 font-medium text-[#f2e5cf] text-sm">
                  {fileDisplayTitle(doc)}
                </p>
                <div className="mt-2 flex items-center gap-1.5 text-[#b8aa8c] text-xs">
                  <Folder className="h-3.5 w-3.5" />
                  <span className="truncate">{normalizeFolderPath(doc.folderPath)}</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[#b8aa8c] text-xs">
                  <Clock3 className="h-3.5 w-3.5" />
                  <span>{formatDate(doc.updatedAt ?? doc.createdAt)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between border-[#345341] border-t pt-2 text-xs">
                  <span className="text-[#b7a789]">{fileTypeLabel(doc)}</span>
                  <span className="font-medium text-[#e6d3ad]">{formatBytes(doc.byteSize)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <DriveUploadManager organizationId={organizationId} />

      <DriveReadingSheet
        chunks={chunks}
        chunksLoading={chunksQuery.isLoading}
        highlightQuote={highlightQuote}
        onChunkSelect={(chunkId) => {
          selectChunk(chunkId);
          updateDriveSearch({
            folder: normalizedFolderPrefix,
            doc: selectedDocId ?? undefined,
            chunk: chunkId,
            quote: undefined,
          });
        }}
        onOpenChange={(open) => (open ? setReaderOpen(true) : closeReader())}
        open={readerOpen}
        organizationId={organizationId}
        selectedChunkId={selectedChunkId}
        selectedDoc={selectedDoc}
        selectedDocId={selectedDocId}
        t={t}
      />
    </div>
  );
}
