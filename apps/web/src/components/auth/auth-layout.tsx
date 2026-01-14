import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  description: string;
}

export function AuthLayout({ children, title, description }: AuthLayoutProps) {
  return (
    <div className="grid min-h-screen bg-[#0a0a0b] lg:grid-cols-2">
      {/* Left side - Branding */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-violet-950 via-[#0f0f10] to-[#0a0a0b] p-10 text-white lg:flex">
        {/* Background gradient effects */}
        <div className="absolute top-0 left-0 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 bg-violet-600/20 blur-[120px]" />
        <div className="absolute right-0 bottom-0 h-[400px] w-[400px] translate-x-1/2 translate-y-1/2 bg-purple-600/10 blur-[100px]" />

        <Link
          className="relative z-10 flex items-center gap-2 font-semibold text-lg"
          to="/"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <span>MEMORYSTACK</span>
        </Link>

        <div className="relative z-10 space-y-6">
          <blockquote className="space-y-4">
            <p className="text-xl text-zinc-300 leading-relaxed">
              "MEMORYSTACK transformed how I manage my inbox. I never miss commitments,
              and the AI summaries save me hours every week. It's like having a
              perfect memory for all my email conversations."
            </p>
            <footer className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-purple-600 font-semibold text-sm">
                MK
              </div>
              <div>
                <div className="font-medium">Michael Kim</div>
                <div className="text-sm text-zinc-500">
                  Product Lead at Stripe
                </div>
              </div>
            </footer>
          </blockquote>
        </div>

        <div className="relative z-10 flex items-center gap-4 text-sm text-zinc-500">
          <span>&copy; {new Date().getFullYear()} MEMORYSTACK</span>
          <span className="text-zinc-700">&middot;</span>
          <Link className="transition-colors hover:text-zinc-300" to="/">
            Privacy Policy
          </Link>
          <span className="text-zinc-700">&middot;</span>
          <Link className="transition-colors hover:text-zinc-300" to="/">
            Terms of Service
          </Link>
        </div>
      </div>

      {/* Right side - Form */}
      <div className="flex flex-col justify-center bg-[#0a0a0b] p-6 lg:p-10">
        <div className="mx-auto w-full max-w-[400px] space-y-6">
          {/* Mobile logo */}
          <div className="mb-8 flex justify-center lg:hidden">
            <Link
              className="flex items-center gap-2 font-semibold text-lg text-white"
              to="/"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600">
                <Sparkles className="h-4 w-4 text-white" />
              </div>
              <span>MEMORYSTACK</span>
            </Link>
          </div>

          <div className="space-y-2 text-center">
            <h1 className="font-semibold text-2xl text-white tracking-tight">
              {title}
            </h1>
            <p className="text-sm text-zinc-400">{description}</p>
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
