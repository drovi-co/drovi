import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle,
  Clock,
  Loader2,
  Mail,
  MoreHorizontal,
  Search,
  UserCheck,
  UserMinus,
  UserPlus,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input, Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/admin/waitlist")({
  component: AdminWaitlistPage,
});

type WaitlistStatus = "pending" | "approved" | "rejected" | "converted" | "all";

function AdminWaitlistPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<WaitlistStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Detail dialog state
  const [selectedApplicationId, setSelectedApplicationId] = useState<
    string | null
  >(null);

  // Approve dialog state
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [approveApplicationId, setApproveApplicationId] = useState<
    string | null
  >(null);
  const [approveNotes, setApproveNotes] = useState("");

  // Reject dialog state
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectApplicationId, setRejectApplicationId] = useState<string | null>(
    null
  );
  const [rejectReason, setRejectReason] = useState("");
  const [rejectNotes, setRejectNotes] = useState("");

  // Fetch stats
  const { data: stats } = useQuery(trpc.waitlist.getStats.queryOptions());

  // Fetch applications
  const { data: applicationsData, isPending } = useQuery(
    trpc.waitlist.list.queryOptions({
      status: statusFilter,
      search: searchQuery || undefined,
      limit: 100,
    })
  );

  // Mutations
  const approveMutation = useMutation(
    trpc.waitlist.approve.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Application approved! Invite code: ${data.code}`);
        setApproveDialogOpen(false);
        setApproveApplicationId(null);
        setApproveNotes("");
        queryClient.invalidateQueries({ queryKey: ["waitlist"] });
      },
      onError: (error) => {
        toast.error(error.message);
      },
    })
  );

  const rejectMutation = useMutation(
    trpc.waitlist.reject.mutationOptions({
      onSuccess: () => {
        toast.success("Application rejected");
        setRejectDialogOpen(false);
        setRejectApplicationId(null);
        setRejectReason("");
        setRejectNotes("");
        queryClient.invalidateQueries({ queryKey: ["waitlist"] });
      },
      onError: (error) => {
        toast.error(error.message);
      },
    })
  );

  const resendMutation = useMutation(
    trpc.waitlist.resendInvite.mutationOptions({
      onSuccess: () => {
        toast.success("Invite email resent");
        queryClient.invalidateQueries({ queryKey: ["waitlist"] });
      },
      onError: (error) => {
        toast.error(error.message);
      },
    })
  );

  const applications = applicationsData?.applications ?? [];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge className="bg-amber-500/10 text-amber-500" variant="outline">
            <Clock className="mr-1 h-3 w-3" />
            Pending
          </Badge>
        );
      case "approved":
        return (
          <Badge className="bg-blue-500/10 text-blue-500" variant="outline">
            <UserCheck className="mr-1 h-3 w-3" />
            Approved
          </Badge>
        );
      case "rejected":
        return (
          <Badge className="bg-red-500/10 text-red-500" variant="outline">
            <XCircle className="mr-1 h-3 w-3" />
            Rejected
          </Badge>
        );
      case "converted":
        return (
          <Badge
            className="bg-emerald-500/10 text-emerald-500"
            variant="outline"
          >
            <CheckCircle className="mr-1 h-3 w-3" />
            Converted
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleApprove = (applicationId: string) => {
    setApproveApplicationId(applicationId);
    setApproveDialogOpen(true);
  };

  const handleReject = (applicationId: string) => {
    setRejectApplicationId(applicationId);
    setRejectDialogOpen(true);
  };

  const handleResend = (applicationId: string) => {
    resendMutation.mutate({ applicationId });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-3xl tracking-tight">Waitlist</h1>
          <p className="text-muted-foreground">
            Manage waitlist applications and invite codes
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pending</CardDescription>
            <CardTitle className="text-3xl text-amber-500">
              {stats?.pending ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Approved</CardDescription>
            <CardTitle className="text-3xl text-blue-500">
              {stats?.approved ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Converted</CardDescription>
            <CardTitle className="text-3xl text-emerald-500">
              {stats?.converted ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Rejected</CardDescription>
            <CardTitle className="text-3xl text-red-500">
              {stats?.rejected ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Last 7 days</CardDescription>
            <CardTitle className="text-3xl">
              {stats?.newLast7Days ?? 0}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by email, name, or company..."
            value={searchQuery}
          />
        </div>
        <Select
          onValueChange={(value) => setStatusFilter(value as WaitlistStatus)}
          value={statusFilter}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Applications</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="converted">Converted</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Applications Table */}
      <Card>
        <CardHeader>
          <CardTitle>Applications</CardTitle>
          <CardDescription>
            {applicationsData?.total ?? 0} application
            {(applicationsData?.total ?? 0) !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : applications.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No applications found
            </p>
          ) : (
            <div className="space-y-2">
              {/* Header row */}
              <div className="grid grid-cols-[1fr_1fr_120px_120px_100px_40px] gap-4 border-b px-2 pb-2 text-muted-foreground text-sm">
                <span>Applicant</span>
                <span>Company / Role</span>
                <span>Status</span>
                <span>Submitted</span>
                <span>Invite Code</span>
                <span />
              </div>

              {/* Application rows */}
              {applications.map((app) => (
                <div
                  className="grid grid-cols-[1fr_1fr_120px_120px_100px_40px] items-center gap-4 rounded-md px-2 py-3 hover:bg-muted/50"
                  key={app.id}
                >
                  <div>
                    <p className="font-medium">{app.name}</p>
                    <p className="text-muted-foreground text-sm">{app.email}</p>
                  </div>
                  <div className="text-sm">
                    {app.company && <p>{app.company}</p>}
                    {app.role && (
                      <p className="text-muted-foreground">{app.role}</p>
                    )}
                    {!(app.company || app.role) && (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                  <div>{getStatusBadge(app.status)}</div>
                  <div className="text-muted-foreground text-sm">
                    {formatDistanceToNow(new Date(app.createdAt), {
                      addSuffix: true,
                    })}
                  </div>
                  <div className="font-mono text-muted-foreground text-xs">
                    {app.inviteCode?.code ?? "—"}
                  </div>
                  <div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-xs" variant="ghost">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setSelectedApplicationId(app.id)}
                        >
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {app.status === "pending" && (
                          <>
                            <DropdownMenuItem
                              onClick={() => handleApprove(app.id)}
                            >
                              <UserPlus className="mr-2 h-4 w-4" />
                              Approve
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => handleReject(app.id)}
                            >
                              <UserMinus className="mr-2 h-4 w-4" />
                              Reject
                            </DropdownMenuItem>
                          </>
                        )}
                        {app.status === "approved" && app.inviteCode && (
                          <DropdownMenuItem
                            onClick={() => handleResend(app.id)}
                          >
                            <Mail className="mr-2 h-4 w-4" />
                            Resend Invite
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Approve Dialog */}
      <Dialog onOpenChange={setApproveDialogOpen} open={approveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Application</DialogTitle>
            <DialogDescription>
              This will generate an invite code and send it to the applicant.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="font-medium text-sm" htmlFor="admin-notes">
                Admin Notes (optional)
              </label>
              <Textarea
                id="admin-notes"
                onChange={(e) => setApproveNotes(e.target.value)}
                placeholder="Internal notes about this application..."
                value={approveNotes}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => setApproveDialogOpen(false)}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              disabled={approveMutation.isPending}
              onClick={() => {
                if (approveApplicationId) {
                  approveMutation.mutate({
                    applicationId: approveApplicationId,
                    adminNotes: approveNotes || undefined,
                  });
                }
              }}
            >
              {approveMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Approving...
                </>
              ) : (
                "Approve & Send Invite"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog onOpenChange={setRejectDialogOpen} open={rejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Application</DialogTitle>
            <DialogDescription>
              Optionally provide a reason that may be sent to the applicant.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="font-medium text-sm" htmlFor="reject-reason">
                Rejection Reason (shown to applicant)
              </label>
              <Textarea
                id="reject-reason"
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="We're sorry, but..."
                value={rejectReason}
              />
            </div>
            <div className="space-y-2">
              <label
                className="font-medium text-sm"
                htmlFor="reject-admin-notes"
              >
                Admin Notes (internal only)
              </label>
              <Textarea
                id="reject-admin-notes"
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="Internal notes..."
                value={rejectNotes}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => setRejectDialogOpen(false)}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              disabled={rejectMutation.isPending}
              onClick={() => {
                if (rejectApplicationId) {
                  rejectMutation.mutate({
                    applicationId: rejectApplicationId,
                    reason: rejectReason || undefined,
                    adminNotes: rejectNotes || undefined,
                  });
                }
              }}
              variant="destructive"
            >
              {rejectMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Rejecting...
                </>
              ) : (
                "Reject Application"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <ApplicationDetailDialog
        applicationId={selectedApplicationId}
        onClose={() => setSelectedApplicationId(null)}
      />
    </div>
  );
}

function ApplicationDetailDialog({
  applicationId,
  onClose,
}: {
  applicationId: string | null;
  onClose: () => void;
}) {
  const trpc = useTRPC();

  const { data: application, isPending } = useQuery({
    ...trpc.waitlist.getById.queryOptions({ id: applicationId ?? "" }),
    enabled: !!applicationId,
  });

  if (!applicationId) {
    return null;
  }

  return (
    <Dialog onOpenChange={() => onClose()} open={!!applicationId}>
      <DialogContent className="max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Application Details</DialogTitle>
        </DialogHeader>

        {isPending ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : application ? (
          <div className="space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-muted-foreground text-sm">Name</p>
                <p className="font-medium">{application.name}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-sm">Email</p>
                <p className="font-medium">{application.email}</p>
              </div>
              {application.company && (
                <div>
                  <p className="text-muted-foreground text-sm">Company</p>
                  <p className="font-medium">{application.company}</p>
                </div>
              )}
              {application.role && (
                <div>
                  <p className="text-muted-foreground text-sm">Role</p>
                  <p className="font-medium">{application.role}</p>
                </div>
              )}
            </div>

            {/* Use Case */}
            {application.useCase && (
              <div>
                <p className="mb-1 text-muted-foreground text-sm">Use Case</p>
                <p className="rounded-md border bg-muted/30 p-3 text-sm">
                  {application.useCase}
                </p>
              </div>
            )}

            {/* Status & Dates */}
            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-sm">Status</span>
                <span className="font-medium capitalize">
                  {application.status}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-sm">Submitted</span>
                <span className="text-sm">
                  {new Date(application.createdAt).toLocaleDateString()}
                </span>
              </div>
              {application.reviewedAt && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">
                    Reviewed
                  </span>
                  <span className="text-sm">
                    {new Date(application.reviewedAt).toLocaleDateString()}
                    {application.reviewedBy &&
                      ` by ${application.reviewedBy.name}`}
                  </span>
                </div>
              )}
            </div>

            {/* Invite Code */}
            {application.inviteCode && (
              <div className="rounded-md border bg-muted/30 p-4">
                <p className="mb-1 text-muted-foreground text-sm">
                  Invite Code
                </p>
                <p className="font-mono text-lg">
                  {application.inviteCode.code}
                </p>
                {application.inviteCode.usedAt && (
                  <p className="mt-2 text-emerald-500 text-sm">
                    Used on{" "}
                    {new Date(
                      application.inviteCode.usedAt
                    ).toLocaleDateString()}
                  </p>
                )}
                {application.inviteCode.expiresAt &&
                  !application.inviteCode.usedAt && (
                    <p className="mt-2 text-muted-foreground text-sm">
                      Expires{" "}
                      {new Date(
                        application.inviteCode.expiresAt
                      ).toLocaleDateString()}
                    </p>
                  )}
              </div>
            )}

            {/* Admin Notes */}
            {application.adminNotes && (
              <div>
                <p className="mb-1 text-muted-foreground text-sm">
                  Admin Notes
                </p>
                <p className="rounded-md border bg-amber-500/5 p-3 text-sm">
                  {application.adminNotes}
                </p>
              </div>
            )}

            {/* Rejection Reason */}
            {application.rejectionReason && (
              <div>
                <p className="mb-1 text-muted-foreground text-sm">
                  Rejection Reason
                </p>
                <p className="rounded-md border bg-red-500/5 p-3 text-sm">
                  {application.rejectionReason}
                </p>
              </div>
            )}

            {/* Metadata */}
            <div className="border-t pt-4 text-muted-foreground text-xs">
              {application.referralSource && (
                <p>Referral: {application.referralSource}</p>
              )}
              {application.ipAddress && <p>IP: {application.ipAddress}</p>}
            </div>
          </div>
        ) : (
          <p className="py-8 text-center text-muted-foreground">
            Application not found
          </p>
        )}

        <DialogFooter>
          <Button onClick={onClose} variant="secondary">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
