import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  FileSearch,
  Gauge,
  Handshake,
  Inbox,
  Layers,
  Link2,
  MessageSquare,
  Network,
  Scale,
  Search,
  Shield,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { WaitlistDialog } from "@/components/waitlist/waitlist-dialog";
import { useSession } from "@/lib/auth-client";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return (
    <div className="dark min-h-screen overflow-x-hidden bg-background text-foreground antialiased">
      {/* Animated background */}
      <div className="fixed inset-0 -z-10">
        {/* Neural network pattern */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMSIgZmlsbD0icmdiYSg4Nyw5MSwxOTksMC4xNSkiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-40" />
        {/* Gradient orbs */}
        <div className="absolute top-0 left-1/4 h-[800px] w-[800px] -translate-x-1/2 animate-pulse bg-gradient-to-br from-primary/30 via-primary/20 to-transparent blur-[120px]" />
        <div className="absolute top-1/2 right-0 h-[600px] w-[600px] bg-gradient-to-l from-blue-500/20 via-primary/15 to-transparent blur-[100px]" />
        <div className="absolute bottom-0 left-1/3 h-[500px] w-[500px] bg-gradient-to-t from-primary/20 to-transparent blur-[80px]" />
      </div>

      {/* Navigation */}
      <nav className="fixed top-0 right-0 left-0 z-50 border-border border-b bg-background/80 backdrop-blur-2xl">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-10">
              <Link className="flex items-center gap-3" to="/">
                <img
                  alt="Drovi"
                  className="h-10 w-10 rounded-lg"
                  src="/logo-dark.jpg"
                />
                <div className="flex items-baseline gap-3">
                  <span className="font-bold text-foreground text-xl tracking-tight">
                    Drovi
                  </span>
                  <span className="hidden text-muted-foreground text-xs uppercase tracking-widest sm:inline">
                    Institutional memory
                  </span>
                </div>
              </Link>
              <div className="hidden items-center gap-8 lg:flex">
                <a
                  className="text-muted-foreground text-sm transition-colors hover:text-foreground"
                  href="#how-it-works"
                >
                  Platform
                </a>
                <a
                  className="text-muted-foreground text-sm transition-colors hover:text-foreground"
                  href="#agents"
                >
                  Agents
                </a>
                <a
                  className="text-muted-foreground text-sm transition-colors hover:text-foreground"
                  href="#features"
                >
                  Use Cases
                </a>
                <a
                  className="text-muted-foreground text-sm transition-colors hover:text-foreground"
                  href="#pricing"
                >
                  Pricing
                </a>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {isAuthenticated ? (
                <Link to="/dashboard">
                  <Button size="lg">
                    Go to Dashboard
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              ) : (
                <>
                  <Link to="/login">
                    <Button
                      className="text-muted-foreground hover:text-foreground"
                      variant="ghost"
                    >
                      Sign in
                    </Button>
                  </Link>
                  <WaitlistDialog>
                    <Button size="lg">Request Access</Button>
                  </WaitlistDialog>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative px-6 pt-36 pb-24">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col items-center text-center">
            {/* Status badge */}
            <Badge className="mb-8 gap-3 px-5 py-2 text-sm">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
              </span>
              Multi-source memory layer (Email • Slack • WhatsApp • Docs •
              Calendar • Notion)
            </Badge>

            {/* Main headline */}
            <h1 className="mb-8 max-w-5xl font-bold text-5xl leading-[1.05] tracking-tight md:text-7xl lg:text-8xl">
              <span className="block bg-gradient-to-b from-foreground via-foreground to-muted-foreground bg-clip-text text-transparent">
                Memory.
              </span>
              <span className="block text-primary">Made for work.</span>
            </h1>

            {/* Subheadline */}
            <p className="mb-12 max-w-3xl text-muted-foreground text-xl leading-relaxed md:text-2xl">
              Drovi is an{" "}
              <span className="font-medium text-foreground">
                AI-native intelligence layer
              </span>{" "}
              that connects to your tools and builds a living memory of your
              work{" "}
              <span className="font-medium text-foreground">
                decisions, commitments, owners, context.
              </span>{" "}
              <span className="text-primary">
                Not another inbox. Not another task app.
              </span>{" "}
              A system of truth that stays in sync.
            </p>

            {/* CTAs */}
            <div className="flex flex-col items-center gap-5 sm:flex-row">
              {isAuthenticated ? (
                <Link to="/dashboard">
                  <Button className="h-14 px-10 text-lg" size="lg">
                    Open Dashboard
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
              ) : (
                <WaitlistDialog>
                  <Button className="h-14 px-10 text-lg" size="lg">
                    Request Access
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </WaitlistDialog>
              )}
              <a href="#how-it-works">
                <Button
                  className="h-14 px-10 text-lg"
                  size="lg"
                  variant="secondary"
                >
                  See How It Works
                  <ChevronRight className="ml-2 h-5 w-5" />
                </Button>
              </a>
            </div>

            {/* Trust indicators */}
            <div className="mt-20 flex flex-col items-center gap-6">
              <p className="text-muted-foreground text-sm uppercase tracking-widest">
                Built for high-stakes work
              </p>
              <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
                {[
                  "Founders & Operators",
                  "Deal-heavy Teams",
                  "Chiefs of Staff",
                  "Legal & Finance",
                  "Consulting & Agencies",
                ].map((role) => (
                  <span
                    className="font-medium text-muted-foreground"
                    key={role}
                  >
                    {role}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem/Solution Section */}
      <section className="relative border-border border-y px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-16 lg:grid-cols-2 lg:gap-24">
            {/* The Problem */}
            <div className="relative">
              <Badge className="mb-6 gap-2" variant="destructive">
                <span className="h-2 w-2 rounded-full bg-destructive" />
                The Problem
              </Badge>
              <h2 className="mb-6 font-bold text-3xl text-muted-foreground md:text-4xl">
                Work is fragmented.{" "}
                <span className="text-destructive">Memory is broken.</span>
              </h2>
              <ul className="space-y-4 text-lg text-muted-foreground">
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-destructive/50" />
                  "Where did we agree on this — Slack, email, or a doc?"
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-destructive/50" />
                  "Did we already decide this? Why?"
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-destructive/50" />
                  "Who owns this now?"
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-destructive/50" />
                  "What am I still waiting on?"
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-destructive/50" />
                  The same debates repeat. Commitments quietly slip.
                </li>
              </ul>
            </div>

            {/* The Solution */}
            <div className="relative">
              <Badge className="mb-6 gap-2" variant="success">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                The Solution
              </Badge>
              <h2 className="mb-6 font-bold text-3xl text-foreground md:text-4xl">
                One <span className="text-emerald-500">system of truth</span>{" "}
                across your tools
              </h2>
              <ul className="space-y-4 text-foreground/80 text-lg">
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-500" />
                  Decisions and commitments extracted automatically
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-500" />
                  A unified smart inbox with AI briefs (not raw noise)
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-500" />
                  Every commitment becomes a trackable object with owner,
                  status, and priority
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-500" />
                  Ask anything. Get answers grounded in source context
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-500" />
                  Analytics that show where execution drifts
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="relative px-6 py-24" id="how-it-works">
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-bold text-3xl md:text-5xl">
              <span className="bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
                How Drovi Works
              </span>
            </h2>
            <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
              Connect once. Truth stays current.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {howItWorks.map((step, index) => (
              <div className="group relative" key={step.title}>
                {/* Connector line */}
                {index < 2 && (
                  <div className="absolute top-16 left-[60%] hidden h-px w-[80%] bg-gradient-to-r from-primary/50 to-transparent md:block" />
                )}
                <Card className="relative p-8 transition-all hover:border-primary/30 hover:bg-primary/5">
                  <div className="mb-6 flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                      <step.icon className="h-7 w-7 text-primary" />
                    </div>
                    <span className="font-bold text-5xl text-foreground/10">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <CardTitle className="mb-3 text-xl">{step.title}</CardTitle>
                  <CardDescription className="text-base leading-relaxed">
                    {step.description}
                  </CardDescription>
                </Card>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 8 AI Agents Section */}
      <section
        className="relative border-border border-y px-6 py-24"
        id="agents"
      >
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 text-center">
            <Badge className="mb-4 gap-2">
              <Sparkles className="h-4 w-4" />8 Specialized Agents
            </Badge>
            <h2 className="mb-4 font-bold text-3xl md:text-5xl">
              <span className="bg-gradient-to-r from-foreground via-primary to-foreground bg-clip-text text-transparent">
                Your Intelligence Layer
              </span>
            </h2>
            <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
              Drovi runs a set of specialized agents that keep your system of
              truth accurate over time — syncing sources, extracting decisions
              and commitments, updating status, and surfacing what matters.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {agents.map((agent) => (
              <Card
                className="group relative p-6 transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10"
                key={agent.name}
              >
                <div
                  className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl ${agent.gradient} shadow-lg`}
                >
                  <agent.icon className="h-6 w-6 text-white" />
                </div>
                <CardTitle className="mb-2 text-lg">{agent.name}</CardTitle>
                <CardDescription className="leading-relaxed">
                  {agent.description}
                </CardDescription>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Key Features / Use Cases */}
      <section className="relative px-6 py-24" id="features">
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-bold text-3xl md:text-5xl">
              <span className="bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
                Execution, Powered by Memory
              </span>
            </h2>
            <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
              Drovi doesn't store information. It keeps decisions and
              commitments alive — across every tool you use.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <Card
                className="group relative p-8 transition-all hover:border-border-hover"
                key={feature.title}
              >
                <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="mb-3 text-xl">{feature.title}</CardTitle>
                <CardDescription className="text-base leading-relaxed">
                  {feature.description}
                </CardDescription>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonial/Quote Section */}
      <section className="relative border-border border-y px-6 py-24">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-8 flex justify-center">
            <div className="flex -space-x-3">
              {[...new Array(5)].map((_, i) => (
                <div
                  className="h-12 w-12 rounded-full border-2 border-background bg-primary"
                  key={i}
                />
              ))}
            </div>
          </div>
          <blockquote className="mb-8 font-medium text-2xl text-foreground leading-relaxed md:text-3xl">
            "It's the first system that actually keeps track of what we decided
            and what we owe —{" "}
            <span className="text-primary">without manual work.</span>"
          </blockquote>
          <p className="text-muted-foreground">— Private Beta User</p>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="relative px-6 py-24" id="pricing">
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-bold text-3xl md:text-5xl">
              <span className="bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
                Simple, Transparent Pricing
              </span>
            </h2>
            <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
              Start small. Scale when your team relies on Drovi daily.
            </p>
          </div>

          <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-3">
            {plans.map((plan) => (
              <Card
                className={`relative p-8 ${
                  plan.popular
                    ? "border-primary/50 bg-gradient-to-b from-primary/10 to-transparent shadow-primary/10 shadow-xl"
                    : ""
                }`}
                key={plan.name}
              >
                {plan.popular && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                    Most Popular
                  </Badge>
                )}
                <div className="mb-6">
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                </div>
                <div className="mb-8">
                  <span className="font-bold text-5xl text-foreground">
                    {plan.price}
                  </span>
                  {plan.price !== "Custom" && (
                    <span className="text-muted-foreground">/month</span>
                  )}
                </div>
                <ul className="mb-8 space-y-4">
                  {plan.features.map((feature) => (
                    <li
                      className="flex items-start gap-3 text-foreground/80 text-sm"
                      key={feature}
                    >
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                      {feature}
                    </li>
                  ))}
                </ul>
                {isAuthenticated ? (
                  <Link className="block" to="/dashboard">
                    <Button
                      className="h-12 w-full"
                      variant={plan.popular ? "default" : "secondary"}
                    >
                      Open Dashboard
                    </Button>
                  </Link>
                ) : (
                  <WaitlistDialog>
                    <Button
                      className="h-12 w-full"
                      variant={plan.popular ? "default" : "secondary"}
                    >
                      {plan.cta}
                    </Button>
                  </WaitlistDialog>
                )}
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative border-border border-t px-6 py-24">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="mb-6 font-bold text-4xl md:text-5xl">
            <span className="bg-gradient-to-r from-foreground via-primary to-foreground bg-clip-text text-transparent">
              Ready to stop losing decisions and dropping commitments?
            </span>
          </h2>
          <p className="mb-10 text-muted-foreground text-xl">
            Connect your tools. Let Drovi build the memory layer. Operate from
            one system of truth.
          </p>
          {isAuthenticated ? (
            <Link to="/dashboard">
              <Button className="h-16 px-12 text-xl" size="lg">
                Open Dashboard
                <ArrowRight className="ml-3 h-6 w-6" />
              </Button>
            </Link>
          ) : (
            <WaitlistDialog>
              <Button className="h-16 px-12 text-xl" size="lg">
                Request Access
                <ArrowRight className="ml-3 h-6 w-6" />
              </Button>
            </WaitlistDialog>
          )}
          <p className="mt-6 text-muted-foreground text-sm">
            No credit card required • Private beta • Cancel anytime
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-border border-t px-6 py-16">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col items-center justify-between gap-8 md:flex-row">
            <div className="flex items-center gap-3">
              <img
                alt="Drovi"
                className="h-10 w-10 rounded-lg"
                src="/logo-dark.jpg"
              />
              <span className="font-bold text-foreground text-xl">Drovi</span>
            </div>
            <div className="flex items-center gap-8 text-muted-foreground text-sm">
              <a className="transition-colors hover:text-foreground" href="#">
                Privacy
              </a>
              <a className="transition-colors hover:text-foreground" href="#">
                Terms
              </a>
              <a className="transition-colors hover:text-foreground" href="#">
                Security
              </a>
              <a className="transition-colors hover:text-foreground" href="#">
                Contact
              </a>
            </div>
          </div>
          <div className="mt-12 text-center text-muted-foreground/60 text-sm">
            © {new Date().getFullYear()} Drovi. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

const howItWorks = [
  {
    icon: Link2,
    title: "Connect Your Sources",
    description:
      "Securely connect email, Slack, WhatsApp, calendar, docs, and Notion. Drovi backfills history and stays continuously synced.",
  },
  {
    icon: Database,
    title: "Drovi Builds Your Memory Graph",
    description:
      "Specialized agents extract decisions, commitments, owners, deadlines, and context — then keep everything updated as work evolves.",
  },
  {
    icon: Inbox,
    title: "Operate From One System of Truth",
    description:
      "A unified smart inbox + execution backlog. Every ‘we should’ and ‘I’ll do’ becomes a trackable object — with context attached.",
  },
];

const agents = [
  {
    icon: MessageSquare,
    name: "Conversation Understanding",
    description:
      "Understands threads and messages across sources, extracting key claims, questions, and context.",
    gradient: "bg-gradient-to-br from-blue-500 to-cyan-500",
  },
  {
    icon: Handshake,
    name: "Commitment Tracking",
    description:
      "Detects promises and requests, assigns owners, infers due dates, and updates status as work progresses.",
    gradient: "bg-gradient-to-br from-emerald-500 to-teal-500",
  },
  {
    icon: Scale,
    name: "Decision Memory",
    description:
      "Captures decisions with rationale, tracks changes over time, and links superseded decisions.",
    gradient: "bg-gradient-to-br from-violet-500 to-purple-500",
  },
  {
    icon: Users,
    name: "Relationship Intelligence",
    description:
      "Builds contact dossiers, highlights important relationships, and surfaces open loops before meetings.",
    gradient: "bg-gradient-to-br from-pink-500 to-rose-500",
  },
  {
    icon: Search,
    name: "Query & Retrieval",
    description:
      "Ask questions in plain language and get answers grounded in your sources — with clear provenance.",
    gradient: "bg-gradient-to-br from-amber-500 to-orange-500",
  },
  {
    icon: Target,
    name: "Priority & Routing",
    description:
      "Suggests what matters now, recommends next actions, and helps route work to the right owner.",
    gradient: "bg-gradient-to-br from-red-500 to-orange-500",
  },
  {
    icon: FileSearch,
    name: "Evidence-Based Replies",
    description:
      "Drafts responses grounded in your prior context and decisions — designed to reduce contradictions.",
    gradient: "bg-gradient-to-br from-indigo-500 to-blue-500",
  },
  {
    icon: Shield,
    name: "Risk & Policy",
    description:
      "Flags contradictions, sensitive information, and policy risks before they become expensive mistakes.",
    gradient: "bg-gradient-to-br from-slate-500 to-zinc-500",
  },
];

const features = [
  {
    icon: Layers,
    title: "Unified Smart Inbox",
    description:
      "One feed across email, Slack, WhatsApp, docs, calendar, and Notion — with AI briefs instead of raw noise.",
  },
  {
    icon: Handshake,
    title: "Commitments as First-Class Objects",
    description:
      "Every promise, request, and follow-up becomes trackable: owner, priority, status, assignee, due date, and full context.",
  },
  {
    icon: Network,
    title: "Decision Memory",
    description:
      "Stop re-litigating decisions. Track what was decided, why, and what replaced it — linked back to the original sources.",
  },
  {
    icon: Clock,
    title: "Multi-source Backfill",
    description:
      "Import history across tools so your memory starts on day one — not after weeks of usage.",
  },
  {
    icon: Brain,
    title: "Ask Drovi",
    description:
      "Ask: “What am I waiting on?”, “What did we decide about X?”, “Who owns this?” — and get answers grounded in context.",
  },
  {
    icon: Gauge,
    title: "Analytics & Drift Detection",
    description:
      "See where commitments pile up, where decisions stall, and where execution drifts — before it becomes a crisis.",
  },
];

const plans = [
  {
    name: "Pro",
    description: "For individuals whose work lives in conversations",
    price: "$29",
    popular: true,
    cta: "Request Access",
    features: [
      "Connected sources (email, Slack, WhatsApp, docs, calendar, Notion)",
      "Unified smart inbox + AI briefs",
      "Commitments & decisions tracking",
      "Ask Drovi (answers grounded in context)",
      "Analytics",
      "Email & chat support",
      "API access",
    ],
  },
  {
    name: "Business",
    description: "For teams that need execution without manual upkeep",
    price: "$49",
    cta: "Request Access",
    features: [
      "Everything in Pro",
      "Team workspace (assignees, shared backlog, permissions)",
      "Advanced analytics & reporting",
      "Priority support",
      "Admin controls",
      "Custom integrations",
      "SSO (coming soon)",
    ],
  },
  {
    name: "Enterprise",
    description: "Security, compliance, and custom deployments",
    price: "Custom",
    cta: "Book a Call",
    features: [
      "Everything in Business",
      "Unlimited team members",
      "Dedicated account manager",
      "Audit logs & security reviews",
      "Data residency options (roadmap)",
      "VPC / on-prem deployment (optional)",
      "SLA & compliance",
    ],
  },
];
