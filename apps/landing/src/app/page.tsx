"use client";

import { useState } from "react";

import { Agents } from "@/components/landing/agents";
import { CTA } from "@/components/landing/cta";
import { Features } from "@/components/landing/features";
import { Footer } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Navigation } from "@/components/landing/navigation";
import { Pricing } from "@/components/landing/pricing";
import { ProblemSolution } from "@/components/landing/problem-solution";
import { Testimonial } from "@/components/landing/testimonial";
import { WaitlistDialog } from "@/components/waitlist/waitlist-dialog";

export default function LandingPage() {
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  const handleRequestAccess = () => {
    setWaitlistOpen(true);
  };

  const handleWatchDemo = () => {
    // TODO: Open demo video modal
    // For now, scroll to how-it-works section
    document
      .getElementById("how-it-works")
      ?.scrollIntoView({ behavior: "smooth" });
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

      {/* Problem/Solution Section */}
      <ProblemSolution />

      {/* How It Works */}
      <HowItWorks />

      {/* 8 AI Agents */}
      <Agents />

      {/* Features */}
      <Features />

      {/* Testimonial */}
      <Testimonial />

      {/* Pricing */}
      <Pricing onRequestAccess={handleRequestAccess} />

      {/* Final CTA */}
      <CTA onRequestAccess={handleRequestAccess} />

      {/* Footer */}
      <Footer />

      {/* Waitlist Dialog */}
      <WaitlistDialog onOpenChange={setWaitlistOpen} open={waitlistOpen} />
    </div>
  );
}
