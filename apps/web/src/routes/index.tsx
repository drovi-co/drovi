import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Brain,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileSearch,
  Handshake,
  Lightbulb,
  Mail,
  MessageSquare,
  Network,
  Scale,
  Search,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  return (
    <div className="min-h-screen bg-[#030308] text-white antialiased overflow-x-hidden">
      {/* Animated background */}
      <div className="fixed inset-0 -z-10">
        {/* Neural network pattern */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMSIgZmlsbD0icmdiYSgxMzksOTIsMjQ2LDAuMSkiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-40" />
        {/* Gradient orbs */}
        <div className="absolute top-0 left-1/4 h-[800px] w-[800px] -translate-x-1/2 bg-gradient-to-br from-violet-600/30 via-purple-600/20 to-transparent blur-[120px] animate-pulse" />
        <div className="absolute top-1/2 right-0 h-[600px] w-[600px] bg-gradient-to-l from-cyan-500/20 via-blue-600/15 to-transparent blur-[100px]" />
        <div className="absolute bottom-0 left-1/3 h-[500px] w-[500px] bg-gradient-to-t from-fuchsia-600/20 to-transparent blur-[80px]" />
      </div>

      {/* Navigation */}
      <nav className="fixed top-0 right-0 left-0 z-50 border-white/5 border-b bg-[#030308]/80 backdrop-blur-2xl">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-10">
              <Link className="flex items-center gap-3" to="/">
                <div className="relative flex h-10 w-10 items-center justify-center">
                  <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 blur-sm opacity-80" />
                  <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500">
                    <Brain className="h-5 w-5 text-white" />
                  </div>
                </div>
                <span className="font-bold text-xl tracking-tight">MEMORYSTACK</span>
              </Link>
              <div className="hidden items-center gap-8 lg:flex">
                <a className="text-sm text-zinc-400 transition-colors hover:text-white" href="#how-it-works">
                  How it Works
                </a>
                <a className="text-sm text-zinc-400 transition-colors hover:text-white" href="#agents">
                  AI Agents
                </a>
                <a className="text-sm text-zinc-400 transition-colors hover:text-white" href="#features">
                  Features
                </a>
                <a className="text-sm text-zinc-400 transition-colors hover:text-white" href="#pricing">
                  Pricing
                </a>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {isAuthenticated ? (
                <Link to="/dashboard">
                  <Button className="bg-gradient-to-r from-violet-500 to-fuchsia-500 font-medium text-white hover:from-violet-600 hover:to-fuchsia-600 shadow-lg shadow-violet-500/25">
                    Go to Dashboard
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              ) : (
                <>
                  <Link to="/login">
                    <Button className="text-zinc-400 hover:bg-white/5 hover:text-white" variant="ghost">
                      Sign in
                    </Button>
                  </Link>
                  <Link to="/login">
                    <Button className="bg-gradient-to-r from-violet-500 to-fuchsia-500 font-medium text-white hover:from-violet-600 hover:to-fuchsia-600 shadow-lg shadow-violet-500/25">
                      Get Started Free
                    </Button>
                  </Link>
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
            <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-violet-500/30 bg-violet-500/10 px-5 py-2 backdrop-blur-sm">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-violet-500" />
              </span>
              <span className="font-medium text-sm text-violet-300">
                Your Email, Transformed into Intelligence
              </span>
            </div>

            {/* Main headline */}
            <h1 className="mb-8 max-w-5xl font-bold text-5xl leading-[1.05] tracking-tight md:text-7xl lg:text-8xl">
              <span className="block bg-gradient-to-b from-white via-white to-zinc-400 bg-clip-text text-transparent">
                Never Forget
              </span>
              <span className="block bg-gradient-to-r from-violet-400 via-fuchsia-400 to-cyan-400 bg-clip-text text-transparent">
                Anything Again
              </span>
            </h1>

            {/* Subheadline */}
            <p className="mb-12 max-w-3xl text-xl text-zinc-400 leading-relaxed md:text-2xl">
              MEMORYSTACK reads your email and builds a{" "}
              <span className="text-white font-medium">living intelligence layer</span>{" "}
              — automatically tracking commitments, remembering decisions, and surfacing insights{" "}
              <span className="text-violet-400">exactly when you need them</span>.
            </p>

            {/* CTAs */}
            <div className="flex flex-col items-center gap-5 sm:flex-row">
              <Link to={isAuthenticated ? "/dashboard" : "/login"}>
                <Button
                  className="h-14 px-10 bg-gradient-to-r from-violet-500 to-fuchsia-500 font-semibold text-lg text-white hover:from-violet-600 hover:to-fuchsia-600 shadow-xl shadow-violet-500/30 transition-all hover:shadow-violet-500/40 hover:scale-105"
                  size="lg"
                >
                  {isAuthenticated ? "Open Dashboard" : "Start Free Trial"}
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <a href="#how-it-works">
                <Button
                  className="h-14 px-10 border-white/10 bg-white/5 text-lg text-white hover:bg-white/10 backdrop-blur-sm"
                  size="lg"
                  variant="outline"
                >
                  See How It Works
                  <ChevronRight className="ml-2 h-5 w-5" />
                </Button>
              </a>
            </div>

            {/* Trust indicators */}
            <div className="mt-20 flex flex-col items-center gap-6">
              <p className="text-sm text-zinc-500 uppercase tracking-widest">Trusted by professionals at</p>
              <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
                {["Fortune 500 Executives", "Law Firms", "Investment Banks", "Tech Leaders", "Consultants"].map((role) => (
                  <span className="font-medium text-zinc-500" key={role}>
                    {role}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem/Solution Section */}
      <section className="relative border-white/5 border-y px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-16 lg:grid-cols-2 lg:gap-24">
            {/* The Problem */}
            <div className="relative">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-red-500/10 border border-red-500/20 px-4 py-1.5">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                <span className="text-sm text-red-400 font-medium">The Problem</span>
              </div>
              <h2 className="mb-6 font-bold text-3xl md:text-4xl text-zinc-300">
                Your inbox is a{" "}
                <span className="text-red-400">black hole</span>{" "}
                of forgotten context
              </h2>
              <ul className="space-y-4 text-lg text-zinc-500">
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-red-500/50 shrink-0" />
                  "What did Sarah promise in that thread 3 months ago?"
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-red-500/50 shrink-0" />
                  "When did we decide to change the launch date?"
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-red-500/50 shrink-0" />
                  "I know we discussed this, but I can't find the email..."
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 rounded-full bg-red-500/50 shrink-0" />
                  Critical commitments slip through the cracks
                </li>
              </ul>
            </div>

            {/* The Solution */}
            <div className="relative">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-4 py-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-sm text-emerald-400 font-medium">The Solution</span>
              </div>
              <h2 className="mb-6 font-bold text-3xl md:text-4xl text-white">
                An AI that{" "}
                <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                  remembers everything
                </span>{" "}
                for you
              </h2>
              <ul className="space-y-4 text-lg text-zinc-300">
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-6 w-6 text-emerald-500 shrink-0" />
                  Instant recall of any conversation, decision, or promise
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-6 w-6 text-emerald-500 shrink-0" />
                  Automatic tracking of commitments with smart reminders
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-6 w-6 text-emerald-500 shrink-0" />
                  One-click meeting briefs with full relationship context
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-6 w-6 text-emerald-500 shrink-0" />
                  AI-grounded replies with inline evidence citations
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
              <span className="bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
                How MEMORYSTACK Works
              </span>
            </h2>
            <p className="mx-auto max-w-2xl text-lg text-zinc-400">
              Connect once. Intelligence forever.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {howItWorks.map((step, index) => (
              <div key={step.title} className="relative group">
                {/* Connector line */}
                {index < 2 && (
                  <div className="hidden md:block absolute top-16 left-[60%] w-[80%] h-px bg-gradient-to-r from-violet-500/50 to-transparent" />
                )}
                <div className="relative rounded-2xl border border-white/5 bg-white/[0.02] p-8 backdrop-blur-sm transition-all hover:border-violet-500/30 hover:bg-violet-500/5">
                  <div className="mb-6 flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/20">
                      <step.icon className="h-7 w-7 text-violet-400" />
                    </div>
                    <span className="font-bold text-5xl text-white/10">{String(index + 1).padStart(2, '0')}</span>
                  </div>
                  <h3 className="mb-3 font-semibold text-xl text-white">{step.title}</h3>
                  <p className="text-zinc-400 leading-relaxed">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 8 AI Agents Section */}
      <section className="relative border-white/5 border-y px-6 py-24" id="agents">
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-violet-500/10 border border-violet-500/20 px-4 py-1.5">
              <Sparkles className="h-4 w-4 text-violet-400" />
              <span className="text-sm text-violet-300 font-medium">8 Specialized AI Agents</span>
            </div>
            <h2 className="mb-4 font-bold text-3xl md:text-5xl">
              <span className="bg-gradient-to-r from-white via-violet-200 to-fuchsia-200 bg-clip-text text-transparent">
                Your Personal Intelligence Team
              </span>
            </h2>
            <p className="mx-auto max-w-2xl text-lg text-zinc-400">
              Each agent is a specialist, working 24/7 to understand, organize, and surface the intelligence hidden in your email.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {agents.map((agent) => (
              <div
                key={agent.name}
                className="group relative rounded-2xl border border-white/5 bg-gradient-to-b from-white/[0.03] to-transparent p-6 transition-all hover:border-violet-500/30 hover:shadow-lg hover:shadow-violet-500/10"
              >
                <div className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl ${agent.gradient} shadow-lg`}>
                  <agent.icon className="h-6 w-6 text-white" />
                </div>
                <h3 className="mb-2 font-semibold text-lg text-white">{agent.name}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{agent.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Key Features */}
      <section className="relative px-6 py-24" id="features">
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-bold text-3xl md:text-5xl">
              <span className="bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
                Intelligence, Not Just Search
              </span>
            </h2>
            <p className="mx-auto max-w-2xl text-lg text-zinc-400">
              MEMORYSTACK doesn't just find emails — it understands them.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group relative rounded-2xl border border-white/5 bg-white/[0.02] p-8 transition-all hover:border-white/10 hover:bg-white/[0.04]"
              >
                <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10">
                  <feature.icon className="h-6 w-6 text-violet-400" />
                </div>
                <h3 className="mb-3 font-semibold text-xl text-white">{feature.title}</h3>
                <p className="text-zinc-400 leading-relaxed">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonial/Quote Section */}
      <section className="relative border-white/5 border-y px-6 py-24">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-8 flex justify-center">
            <div className="flex -space-x-3">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="h-12 w-12 rounded-full border-2 border-[#030308] bg-gradient-to-br from-violet-400 to-fuchsia-400"
                />
              ))}
            </div>
          </div>
          <blockquote className="mb-8 font-medium text-2xl text-white md:text-3xl leading-relaxed">
            "It's like having a photographic memory of every email I've ever sent or received.{" "}
            <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
              MEMORYSTACK changed how I work.
            </span>"
          </blockquote>
          <p className="text-zinc-500">
            — Early Access Users
          </p>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="relative px-6 py-24" id="pricing">
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 font-bold text-3xl md:text-5xl">
              <span className="bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
                Simple, Transparent Pricing
              </span>
            </h2>
            <p className="mx-auto max-w-2xl text-lg text-zinc-400">
              Start free. Scale as your intelligence grows.
            </p>
          </div>

          <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-3">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl border p-8 ${
                  plan.popular
                    ? "border-violet-500/50 bg-gradient-to-b from-violet-500/10 via-fuchsia-500/5 to-transparent shadow-xl shadow-violet-500/10"
                    : "border-white/5 bg-white/[0.02]"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-1.5 font-semibold text-sm shadow-lg">
                    Most Popular
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="font-bold text-xl text-white">{plan.name}</h3>
                  <p className="text-sm text-zinc-500">{plan.description}</p>
                </div>
                <div className="mb-8">
                  <span className="font-bold text-5xl text-white">{plan.price}</span>
                  {plan.price !== "Custom" && (
                    <span className="text-zinc-500">/month</span>
                  )}
                </div>
                <ul className="mb-8 space-y-4">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-sm text-zinc-300">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 text-violet-500 shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link className="block" to={isAuthenticated ? "/dashboard" : "/login"}>
                  <Button
                    className={`w-full h-12 font-semibold ${
                      plan.popular
                        ? "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:from-violet-600 hover:to-fuchsia-600 shadow-lg shadow-violet-500/25"
                        : "border border-white/10 bg-white/5 text-white hover:bg-white/10"
                    }`}
                  >
                    {plan.cta}
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative border-white/5 border-t px-6 py-24">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="mb-6 font-bold text-4xl md:text-5xl">
            <span className="bg-gradient-to-r from-white via-violet-200 to-white bg-clip-text text-transparent">
              Ready to unlock your email's hidden intelligence?
            </span>
          </h2>
          <p className="mb-10 text-xl text-zinc-400">
            Join thousands of professionals who never forget anything anymore.
          </p>
          <Link to={isAuthenticated ? "/dashboard" : "/login"}>
            <Button
              className="h-16 px-12 bg-gradient-to-r from-violet-500 to-fuchsia-500 font-semibold text-xl text-white hover:from-violet-600 hover:to-fuchsia-600 shadow-xl shadow-violet-500/30 transition-all hover:shadow-violet-500/40 hover:scale-105"
              size="lg"
            >
              {isAuthenticated ? "Open Dashboard" : "Get Started — It's Free"}
              <ArrowRight className="ml-3 h-6 w-6" />
            </Button>
          </Link>
          <p className="mt-6 text-sm text-zinc-500">
            No credit card required • 14-day free trial • Cancel anytime
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-white/5 border-t px-6 py-16">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col items-center justify-between gap-8 md:flex-row">
            <div className="flex items-center gap-3">
              <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500">
                <Brain className="h-5 w-5 text-white" />
              </div>
              <span className="font-bold text-xl">MEMORYSTACK</span>
            </div>
            <div className="flex items-center gap-8 text-sm text-zinc-500">
              <a className="transition-colors hover:text-white" href="#">Privacy</a>
              <a className="transition-colors hover:text-white" href="#">Terms</a>
              <a className="transition-colors hover:text-white" href="#">Security</a>
              <a className="transition-colors hover:text-white" href="#">Contact</a>
            </div>
          </div>
          <div className="mt-12 text-center text-sm text-zinc-600">
            © {new Date().getFullYear()} MEMORYSTACK. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

const howItWorks = [
  {
    icon: Mail,
    title: "Connect Your Email",
    description: "Securely connect Gmail or Outlook. MEMORYSTACK begins reading and understanding your email history — going back years if needed.",
  },
  {
    icon: Brain,
    title: "AI Builds Your Memory",
    description: "8 specialized AI agents work together to extract commitments, decisions, relationships, and insights from every conversation.",
  },
  {
    icon: Lightbulb,
    title: "Intelligence On Demand",
    description: "Ask anything in natural language. Get instant answers with citations. Never forget a conversation, promise, or decision again.",
  },
];

const agents = [
  {
    icon: MessageSquare,
    name: "Thread Understanding",
    description: "Reads and comprehends email threads, extracting key claims, questions, and action items.",
    gradient: "bg-gradient-to-br from-blue-500 to-cyan-500",
  },
  {
    icon: Handshake,
    name: "Commitment Tracker",
    description: "Detects promises made by you and others, tracks due dates, and sends smart reminders.",
    gradient: "bg-gradient-to-br from-emerald-500 to-teal-500",
  },
  {
    icon: Scale,
    name: "Decision Memory",
    description: "Captures decisions with rationale, tracks supersessions, and maintains decision history.",
    gradient: "bg-gradient-to-br from-violet-500 to-purple-500",
  },
  {
    icon: Users,
    name: "Relationship Intelligence",
    description: "Builds contact dossiers, tracks communication patterns, and identifies VIP relationships.",
    gradient: "bg-gradient-to-br from-pink-500 to-rose-500",
  },
  {
    icon: Search,
    name: "Knowledge Search",
    description: "Semantic search across all your email. Ask questions in plain English, get answers with sources.",
    gradient: "bg-gradient-to-br from-amber-500 to-orange-500",
  },
  {
    icon: Target,
    name: "Triage & Routing",
    description: "Suggests actions, prioritizes your inbox, and recommends delegation opportunities.",
    gradient: "bg-gradient-to-br from-red-500 to-orange-500",
  },
  {
    icon: FileSearch,
    name: "Grounded Drafting",
    description: "Writes evidence-based replies with inline citations from your email history.",
    gradient: "bg-gradient-to-br from-indigo-500 to-blue-500",
  },
  {
    icon: Shield,
    name: "Risk & Policy",
    description: "Detects contradictions, sensitive information, and potential compliance issues.",
    gradient: "bg-gradient-to-br from-slate-500 to-zinc-500",
  },
];

const features = [
  {
    icon: Clock,
    title: "Full History Import",
    description: "Import years of email history. MEMORYSTACK processes everything in the background, building your complete institutional memory.",
  },
  {
    icon: Search,
    title: "Natural Language Search",
    description: "Ask 'What did John promise about the Q4 launch?' and get instant, cited answers from your email archive.",
  },
  {
    icon: Calendar,
    title: "Meeting Briefs",
    description: "One-click preparation for any meeting. Get a complete brief on the person, relationship history, and open items.",
  },
  {
    icon: TrendingUp,
    title: "Relationship Health",
    description: "Track relationship strength over time. Get alerts when important relationships need attention.",
  },
  {
    icon: Network,
    title: "Decision Tracking",
    description: "Never ask 'when did we decide this?' again. Full decision history with rationale and supersession chains.",
  },
  {
    icon: Zap,
    title: "Smart Drafting",
    description: "AI-written replies that cite your previous conversations. Consistent tone, grounded in evidence.",
  },
];

const plans = [
  {
    name: "Starter",
    description: "For individuals getting started",
    price: "$0",
    cta: "Start Free",
    features: [
      "1 email account",
      "90 days of history",
      "Basic search",
      "5 AI queries/day",
      "Commitment tracking",
    ],
  },
  {
    name: "Professional",
    description: "For power users and small teams",
    price: "$29",
    popular: true,
    cta: "Start Free Trial",
    features: [
      "3 email accounts",
      "Unlimited history",
      "Full semantic search",
      "Unlimited AI queries",
      "All 8 AI agents",
      "Meeting briefs",
      "Priority support",
    ],
  },
  {
    name: "Enterprise",
    description: "For organizations",
    price: "Custom",
    cta: "Contact Sales",
    features: [
      "Unlimited accounts",
      "Team collaboration",
      "SSO & SAML",
      "Custom integrations",
      "Dedicated support",
      "On-premise option",
      "Custom AI training",
    ],
  },
];
