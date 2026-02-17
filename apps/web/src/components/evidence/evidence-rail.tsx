import { Badge } from "@memorystack/ui-core/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@memorystack/ui-core/card";
import { formatDistanceToNow } from "date-fns";
import { ShieldCheck } from "lucide-react";
import { buildProofSummary, type ProofSupersessionState } from "@/lib/proof-summary";

interface EvidenceRailProps {
  evidenceCount: number;
  confidence: number;
  lastVerifiedAt?: Date | null;
  supersessionState?: ProofSupersessionState;
  isUserVerified?: boolean;
  primaryQuote?: string | null;
}

export function EvidenceRail({
  evidenceCount,
  confidence,
  lastVerifiedAt,
  supersessionState = "active",
  isUserVerified = false,
  primaryQuote,
}: EvidenceRailProps) {
  const proof = buildProofSummary({
    evidenceCount,
    lastVerifiedAt,
    supersessionState,
  });

  return (
    <Card className="border-[#345240] bg-[#102318] text-[#f3e8d2]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 font-serif text-base">
          <ShieldCheck className="h-4 w-4 text-[#d5b274]" />
          Evidence Rail
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-[#b08a4b70] bg-[#b08a4b1f] text-[#e6cfaa]" variant="outline">
            {proof.evidenceCode}
          </Badge>
          <Badge className="border-[#3e5f4b] bg-[#173224] text-[#d2c3a8]" variant="outline">
            {proof.verifiedCode}
          </Badge>
          <Badge className="border-[#3e5f4b] bg-[#173224] text-[#d2c3a8]" variant="outline">
            {proof.supersessionCode}
          </Badge>
          <Badge className="border-[#3e5f4b] bg-[#173224] text-[#d2c3a8]" variant="outline">
            C {Math.round(confidence * 100)}%
          </Badge>
        </div>

        <div className="space-y-1 text-[#c7b89b]">
          <p>{proof.evidenceLabel}</p>
          <p>{proof.supersessionLabel}</p>
          {lastVerifiedAt ? (
            <p>
              Last verification{" "}
              {formatDistanceToNow(lastVerifiedAt, { addSuffix: true })}
            </p>
          ) : (
            <p>No verification timestamp recorded</p>
          )}
          {isUserVerified ? <p>Verified by user</p> : null}
        </div>

        {primaryQuote ? (
          <blockquote className="border-[#3f604b] border-l-2 pl-2 text-[#d9c9ab] italic">
            “{primaryQuote}”
          </blockquote>
        ) : null}
      </CardContent>
    </Card>
  );
}
