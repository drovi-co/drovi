import { Link } from "@tanstack/react-router";

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  description: string;
}

export function AuthLayout({ children, title, description }: AuthLayoutProps) {
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-2">
      {/* Left side - Branding */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-primary/20 via-background to-background p-10 text-foreground lg:flex">
        {/* Background gradient effects */}
        <div className="absolute top-0 left-0 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 bg-primary/20 blur-[120px]" />
        <div className="absolute right-0 bottom-0 h-[400px] w-[400px] translate-x-1/2 translate-y-1/2 bg-primary/10 blur-[100px]" />

        <Link
          className="relative z-10 flex items-center gap-2 font-semibold text-lg"
          to="/"
        >
          <img
            alt="Drovi"
            className="h-8 w-8 rounded-lg"
            src="/logo-dark.jpg"
          />
          <span>Drovi</span>
        </Link>

        <div className="relative z-10 space-y-6">
          <blockquote className="space-y-4">
            <p className="text-muted-foreground text-xl leading-relaxed">
              "Drovi transformed how I manage my inbox. I never miss
              commitments, and the AI summaries save me hours every week. It's
              like having a perfect memory for all my email conversations."
            </p>
            <footer className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-sm">
                MK
              </div>
              <div>
                <div className="font-medium">Michael Kim</div>
                <div className="text-muted-foreground text-sm">
                  Product Lead at Stripe
                </div>
              </div>
            </footer>
          </blockquote>
        </div>

        <div className="relative z-10 flex items-center gap-4 text-muted-foreground text-sm">
          <span>&copy; {new Date().getFullYear()} Drovi</span>
          <span className="text-border">&middot;</span>
          <Link className="transition-colors hover:text-foreground" to="/">
            Privacy Policy
          </Link>
          <span className="text-border">&middot;</span>
          <Link className="transition-colors hover:text-foreground" to="/">
            Terms of Service
          </Link>
        </div>
      </div>

      {/* Right side - Form */}
      <div className="flex flex-col justify-center bg-background p-6 lg:p-10">
        <div className="mx-auto w-full max-w-[400px] space-y-6">
          {/* Mobile logo */}
          <div className="mb-8 flex justify-center lg:hidden">
            <Link
              className="flex items-center gap-2 font-semibold text-foreground text-lg"
              to="/"
            >
              <img
                alt="Drovi"
                className="h-8 w-8 rounded-lg"
                src="/logo-dark.jpg"
              />
              <span>Drovi</span>
            </Link>
          </div>

          <div className="space-y-2 text-center">
            <h1 className="font-semibold text-2xl text-foreground tracking-tight">
              {title}
            </h1>
            <p className="text-muted-foreground text-sm">{description}</p>
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
