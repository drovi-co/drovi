import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { z } from "zod";

const searchSchema = z.object({
  tab: z.enum(["browse", "search", "ask"]).optional(),
  doc: z.string().optional(),
  chunk: z.string().optional(),
  quote: z.string().optional(),
  folder: z.string().optional(),
  tags: z.string().optional(),
});

export const Route = createFileRoute("/dashboard/drive")({
  component: lazyRouteComponent(
    () => import("@/modules/drive/pages/drive-page"),
    "DrivePage"
  ),
  validateSearch: searchSchema,
});
