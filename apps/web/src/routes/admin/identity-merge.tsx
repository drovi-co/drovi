import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

export const Route = createFileRoute("/admin/identity-merge")({
  component: IdentityMergePage,
});

function IdentityMergePage() {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{
    contactAId: string;
    contactAName: string | null;
    contactAEmail: string | null;
    contactBId: string;
    contactBName: string | null;
    contactBEmail: string | null;
    confidence: number;
    matchReasons: string[];
  }>>([]);
  const [minConfidence, setMinConfidence] = useState("0.7");
  const [isLoading, setIsLoading] = useState(false);
  const [mergeReason, setMergeReason] = useState("");
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [mergeSource, setMergeSource] = useState<string | null>(null);

  useEffect(() => {
    const loadOrg = async () => {
      try {
        const org = await api.org.getOrgInfo();
        if (org?.id) {
          setOrganizationId(org.id);
        }
      } catch (error) {
        console.error("Failed to load org info", error);
      }
    };

    loadOrg();
  }, []);

  const canFetch = Boolean(organizationId);

  const fetchSuggestions = async () => {
    if (!organizationId) return;
    setIsLoading(true);
    try {
      const data = await api.contacts.listMergeSuggestions({
        organizationId,
        minConfidence: Number(minConfidence),
        limit: 100,
      });
      setSuggestions(data);
    } catch (error) {
      console.error("Failed to load merge suggestions", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (canFetch) {
      fetchSuggestions();
    }
  }, [canFetch]);

  const selectedSummary = useMemo(() => {
    if (!mergeSource || !mergeTarget) return null;
    return suggestions.find(
      (item) =>
        (item.contactAId === mergeSource && item.contactBId === mergeTarget) ||
        (item.contactAId === mergeTarget && item.contactBId === mergeSource)
    );
  }, [mergeSource, mergeTarget, suggestions]);

  const handleMerge = async () => {
    if (!organizationId || !mergeSource || !mergeTarget) return;
    setIsLoading(true);
    try {
      await api.contacts.mergeContacts({
        organizationId,
        sourceContactId: mergeSource,
        targetContactId: mergeTarget,
        reason: mergeReason || undefined,
      });
      setMergeSource(null);
      setMergeTarget(null);
      await fetchSuggestions();
    } catch (error) {
      console.error("Failed to merge contacts", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Identity Resolution</h1>
          <p className="text-muted-foreground">
            Review suggested contact merges and apply manual overrides.
          </p>
        </div>
        <Button onClick={fetchSuggestions} variant="outline" disabled={isLoading || !canFetch}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Merge Suggestions</CardTitle>
          <CardDescription>
            {suggestions.length} candidate pair{suggestions.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Min confidence</span>
              <Input
                className="w-24"
                value={minConfidence}
                onChange={(event) => setMinConfidence(event.target.value)}
              />
            </div>
            <Button variant="secondary" onClick={fetchSuggestions} disabled={isLoading || !canFetch}>
              Apply
            </Button>
          </div>

          {suggestions.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-5 w-5" />
              No merge suggestions found at the current threshold.
            </div>
          ) : (
            <div className="space-y-3">
              {suggestions.map((item) => (
                <button
                  type="button"
                  key={`${item.contactAId}-${item.contactBId}`}
                  className={`w-full rounded-lg border p-4 text-left transition ${
                    mergeSource === item.contactAId && mergeTarget === item.contactBId
                      ? "border-primary bg-primary/5"
                      : "hover:border-foreground/30"
                  }`}
                  onClick={() => {
                    setMergeSource(item.contactAId);
                    setMergeTarget(item.contactBId);
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium">
                        {item.contactAName || item.contactAEmail || item.contactAId}
                      </p>
                      <p className="text-sm text-muted-foreground">{item.contactAEmail}</p>
                    </div>
                    <Badge variant={item.confidence >= 0.85 ? "default" : "secondary"}>
                      {(item.confidence * 100).toFixed(0)}% confidence
                    </Badge>
                    <div className="space-y-1">
                      <p className="font-medium">
                        {item.contactBName || item.contactBEmail || item.contactBId}
                      </p>
                      <p className="text-sm text-muted-foreground">{item.contactBEmail}</p>
                    </div>
                  </div>
                  {item.matchReasons.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {item.matchReasons.map((reason) => (
                        <span key={reason} className="rounded-full bg-muted px-2 py-1">
                          {reason}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Apply Merge</CardTitle>
          <CardDescription>
            Select a suggestion above, confirm the source and target, and apply.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">Source (will be merged)</span>
              <Input value={mergeSource ?? ""} readOnly />
            </div>
            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">Target (will remain)</span>
              <Input value={mergeTarget ?? ""} readOnly />
            </div>
          </div>
          {selectedSummary && (
            <div className="rounded-md border p-3 text-sm text-muted-foreground">
              Suggested because: {selectedSummary.matchReasons.join(" · ")}
            </div>
          )}
          <Input
            placeholder="Merge reason (optional)"
            value={mergeReason}
            onChange={(event) => setMergeReason(event.target.value)}
          />
          <Button
            onClick={handleMerge}
            disabled={!mergeSource || !mergeTarget || isLoading}
          >
            <Check className="mr-2 h-4 w-4" />
            Apply Merge
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
