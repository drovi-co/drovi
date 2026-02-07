"use client";

import type { Query } from "@tanstack/react-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (
      error: Error,
      query: Query<unknown, unknown, unknown, readonly unknown[]>
    ) => {
      const message = error.message || "Something went wrong";
      toast.error(message, {
        action: {
          label: "retry",
          onClick: () => query.invalidate(),
        },
      });
    },
  }),
});
