"use client";

import { useState } from "react";

import { Agents } from "@/components/landing/agents";
import { CTA } from "@/components/landing/cta";
import { DemoModal } from "@/components/landing/demo-modal";
import { Features } from "@/components/landing/features";
import { Footer } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Navigation } from "@/components/landing/navigation";
import { Pricing } from "@/components/landing/pricing";
import { ProblemSolution } from "@/components/landing/problem-solution";
import { WorldBrainCapabilities } from "@/components/landing/world-brain-capabilities";
import { WorldBrainSignal } from "@/components/landing/world-brain-signal";
import { WaitlistDialog } from "@/components/waitlist/waitlist-dialog";

export default function LandingPage() {
  const [demoOpen, setDemoOpen] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  const handleRequestAccess = () => {
    setDemoOpen(false);
    setWaitlistOpen(true);
  };

  const handleWatchDemo = () => {
    setDemoOpen(true);
  };

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      {/* Hero Section with Navigation inside */}
      <div className="relative">
        <Navigation onRequestAccess={handleRequestAccess} />
        <Hero
          onRequestAccess={handleRequestAccess}
          onWatchDemo={handleWatchDemo}
        />
      </div>

      <ProblemSolution />

      <HowItWorks />

      <WorldBrainSignal onRequestAccess={handleRequestAccess} />

      <WorldBrainCapabilities />

      <Agents />

      <Features />

      <Pricing onRequestAccess={handleRequestAccess} />

      <CTA onRequestAccess={handleRequestAccess} />

      <Footer />

      <WaitlistDialog onOpenChange={setWaitlistOpen} open={waitlistOpen} />

      <DemoModal
        onOpenChange={setDemoOpen}
        onRequestAccess={handleRequestAccess}
        open={demoOpen}
      />
    </div>
  );
}
