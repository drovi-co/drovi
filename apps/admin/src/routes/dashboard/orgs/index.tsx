import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@memorystack/ui-core/card";
import { Input } from "@memorystack/ui-core/input";
import { Skeleton } from "@memorystack/ui-core/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@memorystack/ui-core/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { adminAPI } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/dashboard/orgs/")({
  component: AdminOrgsPage,
});

function AdminOrgsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const query = useQuery({
    queryKey: ["admin-orgs", q],
    queryFn: () => adminAPI.listOrgs({ q: q.trim() || undefined, limit: 200 }),
  });

  const rows = useMemo(() => {
    return query.data?.organizations ?? [];
  }, [query.data]);

  return (
    <div className="space-y-4">
      <Card className="border-border/70">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-sm">Organizations</CardTitle>
            <div className="text-muted-foreground text-xs">
              Global org listing (internal).
            </div>
          </div>
          <div className="w-[320px] max-w-full">
            <Input
              onChange={(ev) => setQ(ev.target.value)}
              placeholder="Search by name or id..."
              value={q}
            />
          </div>
        </CardHeader>
        <CardContent>
          {query.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : query.error ? (
            <div className="text-muted-foreground text-sm">
              {query.error instanceof Error
                ? query.error.message
                : "Unknown error"}
            </div>
          ) : rows.length ? (
            <div className="rounded-md border border-border/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden lg:table-cell">ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">
                      Region
                    </TableHead>
                    <TableHead className="text-right">Members</TableHead>
                    <TableHead className="text-right">Connections</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((org) => (
                    <TableRow
                      className={cn("cursor-pointer")}
                      key={String(org.id)}
                      onClick={() =>
                        navigate({
                          to: "/dashboard/orgs/$orgId",
                          params: { orgId: String(org.id) },
                        })
                      }
                    >
                      <TableCell className="font-medium">
                        {String(org.name)}
                      </TableCell>
                      <TableCell className="hidden font-mono text-muted-foreground text-xs lg:table-cell">
                        {String(org.id)}
                      </TableCell>
                      <TableCell className="capitalize">
                        {String(org.status)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {org.region ? String(org.region) : "-"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(org.member_count ?? 0)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(org.connection_count ?? 0)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">
              No organizations found.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
