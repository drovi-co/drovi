import { Badge } from "@memorystack/ui-core/badge";
import type { DriveDocument } from "@/lib/api";

export type SearchMode = "index" | "ai";

export interface FolderNode {
  name: string;
  path: string;
  count: number;
  children: FolderNode[];
  latestUpdatedAt: string | null;
}

export type TranslateFn = (
  key: string,
  params?: Record<string, string | number | boolean | null | undefined>
) => string;

export function normalizeFolderPath(input: string | null | undefined): string {
  const raw = (input ?? "/").trim();
  if (!raw) return "/";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  if (withLeadingSlash === "/") return "/";
  const withoutTrailing = withLeadingSlash.replace(/\/+$/g, "");
  return withoutTrailing || "/";
}

export function folderParent(path: string): string | null {
  const normalized = normalizeFolderPath(path);
  if (normalized === "/") return null;
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return `/${parts.slice(0, -1).join("/")}`;
}

export function matchesFolderPrefix(folderPath: string, prefix: string): boolean {
  const folder = normalizeFolderPath(folderPath);
  const normalizedPrefix = normalizeFolderPath(prefix);
  if (normalizedPrefix === "/") return true;
  if (folder === normalizedPrefix) return true;
  return folder.startsWith(`${normalizedPrefix}/`);
}

export function sameFolder(folderPath: string, target: string): boolean {
  return normalizeFolderPath(folderPath) === normalizeFolderPath(target);
}

export function formatBytes(value: number | null | undefined): string {
  if (!value || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fileDisplayTitle(doc: DriveDocument): string {
  return doc.title?.trim() || doc.fileName || "Untitled file";
}

function mergeLatestDate(
  current: string | null,
  candidate: string | null | undefined
): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  const currentTs = new Date(current).getTime();
  const candidateTs = new Date(candidate).getTime();
  if (Number.isNaN(currentTs)) return candidate;
  if (Number.isNaN(candidateTs)) return current;
  return candidateTs > currentTs ? candidate : current;
}

export function buildFolderTree(documents: DriveDocument[]): FolderNode {
  const root: FolderNode = {
    name: "/",
    path: "/",
    count: 0,
    children: [],
    latestUpdatedAt: null,
  };

  const nodes = new Map<string, FolderNode>([["/", root]]);
  const sortedFolders = Array.from(
    new Set(documents.map((doc) => normalizeFolderPath(doc.folderPath)))
  ).sort();

  for (const folder of sortedFolders) {
    const parts = folder.split("/").filter(Boolean);
    let parent = root;
    let currentPath = "/";
    for (const part of parts) {
      currentPath = currentPath === "/" ? `/${part}` : `${currentPath}/${part}`;
      let node = nodes.get(currentPath);
      if (!node) {
        node = {
          name: part,
          path: currentPath,
          count: 0,
          children: [],
          latestUpdatedAt: null,
        };
        nodes.set(currentPath, node);
        parent.children.push(node);
      }
      parent = node;
    }
  }

  for (const doc of documents) {
    const folder = normalizeFolderPath(doc.folderPath);
    const parts = folder.split("/").filter(Boolean);
    let currentPath = "/";
    const rootNode = nodes.get("/");
    if (rootNode) {
      rootNode.count += 1;
      rootNode.latestUpdatedAt = mergeLatestDate(rootNode.latestUpdatedAt, doc.updatedAt);
    }
    for (const part of parts) {
      currentPath = currentPath === "/" ? `/${part}` : `${currentPath}/${part}`;
      const node = nodes.get(currentPath);
      if (!node) continue;
      node.count += 1;
      node.latestUpdatedAt = mergeLatestDate(node.latestUpdatedAt, doc.updatedAt);
    }
  }

  const sortTree = (node: FolderNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of node.children) sortTree(child);
  };
  sortTree(root);

  return root;
}

export function findFolderNode(root: FolderNode, path: string): FolderNode | null {
  const normalized = normalizeFolderPath(path);
  if (normalized === "/") return root;
  const parts = normalized.split("/").filter(Boolean);
  let current: FolderNode | null = root;
  for (const part of parts) {
    current = current.children.find((child) => child.name === part) ?? null;
    if (!current) return null;
  }
  return current;
}

export function statusBadge(status: string, t: TranslateFn) {
  const normalized = (status || "").toLowerCase();
  if (normalized === "processed") {
    return (
      <Badge className="border-success/35 bg-success/10 text-success" variant="outline">
        {t("drive.status.processed")}
      </Badge>
    );
  }
  if (normalized === "processing") {
    return (
      <Badge className="border-warning/35 bg-warning/10 text-warning" variant="outline">
        {t("drive.status.processing")}
      </Badge>
    );
  }
  if (normalized === "uploaded" || normalized === "uploading") {
    return (
      <Badge className="border-ring/40 bg-ring/10 text-ring" variant="outline">
        {t("drive.status.uploading")}
      </Badge>
    );
  }
  if (normalized === "failed") {
    return (
      <Badge className="border-destructive/35 bg-destructive/10 text-destructive" variant="outline">
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

export function fileTypeLabel(doc: DriveDocument): string {
  const mime = (doc.mimeType ?? "").toLowerCase();
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("word") || mime.includes("officedocument")) return "Document";
  if (mime.includes("image")) return "Image";
  return "File";
}
