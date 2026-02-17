import { useCallback, useEffect, useState } from "react";

export type SearchMode = "index" | "ai";

export interface DriveRouteState {
  folder?: string | null;
  doc?: string | null;
  chunk?: string | null;
  quote?: string | null;
}

export interface DriveSelectionOptions {
  defaultFolder?: string;
  initialSearchMode?: SearchMode;
}

export interface NormalizedDriveRouteState {
  folder: string;
  doc: string | null;
  chunk: string | null;
  quote: string | null;
  readerOpen: boolean;
}

export function normalizeDriveRouteState(
  routeState: DriveRouteState,
  defaultFolder = "/"
): NormalizedDriveRouteState {
  const folder = routeState.folder ?? defaultFolder;
  const doc = routeState.doc ?? null;

  return {
    folder,
    doc,
    chunk: routeState.chunk ?? null,
    quote: routeState.quote ?? null,
    readerOpen: Boolean(doc),
  };
}

export function useDriveSelectionState(
  routeState: DriveRouteState,
  options: DriveSelectionOptions = {}
) {
  const defaultFolder = options.defaultFolder ?? "/";
  const initialSearchMode = options.initialSearchMode ?? "index";

  const normalized = normalizeDriveRouteState(routeState, defaultFolder);
  const [folderPrefix, setFolderPrefix] = useState<string>(normalized.folder);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(normalized.doc);
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(
    normalized.chunk
  );
  const [highlightQuote, setHighlightQuote] = useState<string | null>(
    normalized.quote
  );
  const [readerOpen, setReaderOpen] = useState<boolean>(normalized.readerOpen);
  const [searchMode, setSearchMode] = useState<SearchMode>(initialSearchMode);
  const [searchText, setSearchText] = useState<string>("");

  useEffect(() => setFolderPrefix(routeState.folder ?? defaultFolder), [
    routeState.folder,
    defaultFolder,
  ]);
  useEffect(() => setSelectedDocId(routeState.doc ?? null), [routeState.doc]);
  useEffect(() => setSelectedChunkId(routeState.chunk ?? null), [routeState.chunk]);
  useEffect(() => setHighlightQuote(routeState.quote ?? null), [routeState.quote]);
  useEffect(() => setReaderOpen(Boolean(routeState.doc)), [routeState.doc]);

  const selectFolder = useCallback((nextFolder: string) => {
    setFolderPrefix(nextFolder);
    setSelectedDocId(null);
    setSelectedChunkId(null);
    setHighlightQuote(null);
    setReaderOpen(false);
  }, []);

  const openDocument = useCallback(
    (docId: string, options?: { chunkId?: string; quote?: string }) => {
      setSelectedDocId(docId);
      setSelectedChunkId(options?.chunkId ?? null);
      setHighlightQuote(options?.quote ?? null);
      setReaderOpen(true);
    },
    []
  );

  const closeReader = useCallback(() => {
    setReaderOpen(false);
    setSelectedDocId(null);
    setSelectedChunkId(null);
    setHighlightQuote(null);
  }, []);

  const selectChunk = useCallback((chunkId: string | null) => {
    setSelectedChunkId(chunkId);
    setHighlightQuote(null);
  }, []);

  return {
    folderPrefix,
    selectedDocId,
    selectedChunkId,
    highlightQuote,
    readerOpen,
    searchMode,
    searchText,
    setFolderPrefix,
    setSelectedDocId,
    setSelectedChunkId,
    setHighlightQuote,
    setReaderOpen,
    setSearchMode,
    setSearchText,
    selectFolder,
    openDocument,
    closeReader,
    selectChunk,
  };
}
