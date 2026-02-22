import { Button } from "@memorystack/ui-core/button";
import { Textarea } from "@memorystack/ui-core/textarea";
import { formatDistanceToNow } from "date-fns";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAddUIOComment, useUIOComments } from "@/hooks/use-uio";

interface TeamDiscussionProps {
  organizationId: string;
  uioId: string;
  placeholder?: string;
  emptyText?: string;
}

export function TeamDiscussion({
  organizationId,
  uioId,
  placeholder = "Add an update for your team...",
  emptyText = "No discussion yet. Start the thread for this item.",
}: TeamDiscussionProps) {
  const [draft, setDraft] = useState("");
  const commentsQuery = useUIOComments({
    organizationId,
    id: uioId,
    enabled: !!organizationId && !!uioId,
  });
  const addCommentMutation = useAddUIOComment();

  const comments = useMemo(() => commentsQuery.data ?? [], [commentsQuery.data]);

  const handleSubmit = () => {
    const body = draft.trim();
    if (!body) {
      return;
    }
    addCommentMutation.mutate(
      { organizationId, id: uioId, body },
      {
        onSuccess: () => {
          setDraft("");
        },
        onError: () => {
          toast.error("Failed to post comment");
        },
      }
    );
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {commentsQuery.isLoading ? (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-muted-foreground text-xs">
            Loading discussion...
          </div>
        ) : comments.length > 0 ? (
          comments.map((comment) => (
            <div
              className="rounded-lg border border-border bg-muted/30 px-3 py-3"
              key={comment.id}
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="font-medium text-foreground text-xs">
                  {comment.authorLabel || comment.authorEmail || "Team Member"}
                </span>
                <span className="text-muted-foreground text-xs">
                  {formatDistanceToNow(new Date(comment.createdAt), {
                    addSuffix: true,
                  })}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-foreground text-sm">
                {comment.body}
              </p>
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/40 px-3 py-4 text-muted-foreground text-xs">
            {emptyText}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Textarea
          className="min-h-[86px] resize-none border-border bg-muted/30 text-sm"
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          value={draft}
        />
        <div className="flex justify-end">
          <Button
            disabled={!draft.trim() || addCommentMutation.isPending}
            onClick={handleSubmit}
            size="sm"
          >
            {addCommentMutation.isPending ? "Posting..." : "Post Comment"}
          </Button>
        </div>
      </div>
    </div>
  );
}
