"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DemoSource =
  | { kind: "iframe"; src: string }
  | { kind: "video"; src: string };

interface DemoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequestAccess?: () => void;
}

function extractYouTubeId(url: URL): string | null {
  if (url.hostname === "youtu.be") {
    return url.pathname.slice(1) || null;
  }
  if (url.pathname.startsWith("/embed/")) {
    return url.pathname.split("/embed/")[1] || null;
  }
  return url.searchParams.get("v");
}

function resolveDemoSource(urlValue: string | undefined): DemoSource | null {
  if (!urlValue) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();

  if (pathname.endsWith(".mp4") || pathname.endsWith(".webm")) {
    return { kind: "video", src: parsed.toString() };
  }

  if (hostname.includes("youtube.com") || hostname === "youtu.be") {
    const id = extractYouTubeId(parsed);
    if (!id) {
      return null;
    }
    return {
      kind: "iframe",
      src: `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`,
    };
  }

  if (hostname.includes("vimeo.com")) {
    const segments = parsed.pathname.split("/").filter(Boolean);
    const id = segments[segments.length - 1];
    if (!id) {
      return null;
    }
    return {
      kind: "iframe",
      src: `https://player.vimeo.com/video/${id}?autoplay=1`,
    };
  }

  return { kind: "iframe", src: parsed.toString() };
}

export function DemoModal({
  open,
  onOpenChange,
  onRequestAccess,
}: DemoModalProps) {
  const source = resolveDemoSource(
    process.env.NEXT_PUBLIC_LANDING_DEMO_URL?.trim()
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="w-[calc(100%-24px)] max-w-4xl border-white/10 bg-black p-0 text-white">
        <div className="space-y-4 p-5 pb-0 sm:p-6 sm:pb-0">
          <DialogHeader className="pr-6 text-left">
            <DialogTitle className="font-medium text-[22px] tracking-[-0.5px]">
              Product demo
            </DialogTitle>
            <DialogDescription className="text-[14px] text-white/70">
              See how Drovi captures decisions, commitments, and operational
              truth into one queryable memory layer.
            </DialogDescription>
          </DialogHeader>
        </div>

        {source ? (
          <div className="px-5 pb-5 sm:px-6 sm:pb-6">
            <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
              {source.kind === "video" ? (
                <video
                  autoPlay
                  className="aspect-video w-full"
                  controls
                  preload="metadata"
                >
                  <source src={source.src} />
                </video>
              ) : (
                <iframe
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="aspect-video w-full"
                  src={source.src}
                  title="Drovi demo video"
                />
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4 px-5 pb-6 sm:px-6 sm:pb-7">
            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[14px] text-white/80">
                Demo playback is shared privately. Request access and we will
                send a guided walkthrough with your security and deployment
                context.
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                className="bg-white text-black hover:bg-white/90"
                onClick={onRequestAccess}
                type="button"
              >
                Request private briefing
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
