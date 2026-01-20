import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";

interface OnboardingLayoutProps {
  children: React.ReactNode;
  step: 1 | 2 | 3 | 4;
}

const steps = [
  { number: 1, label: "Create Organization" },
  { number: 2, label: "Connect Email" },
  { number: 3, label: "Invite Team" },
  { number: 4, label: "Get Started" },
];

export function OnboardingLayout({ children, step }: OnboardingLayoutProps) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[380px_1fr]">
      {/* Left side - Progress */}
      <div className="hidden flex-col justify-between border-r bg-muted/50 p-8 lg:flex">
        <div>
          <Link
            className="mb-12 flex items-center gap-2 font-semibold text-lg"
            to="/"
          >
            <img
              alt="Drovi"
              className="h-8 w-8 rounded-lg"
              src="/logo-dark.jpg"
            />
            <span>Drovi</span>
          </Link>

          {/* Steps */}
          <nav className="space-y-1">
            {steps.map((s, index) => {
              const isCompleted = s.number < step;
              const isCurrent = s.number === step;
              const _isUpcoming = s.number > step;

              return (
                <div className="relative" key={s.number}>
                  <div
                    className={`flex items-center gap-4 rounded-lg px-4 py-3 transition-colors ${
                      isCurrent
                        ? "bg-background shadow-sm"
                        : isCompleted
                          ? "text-muted-foreground"
                          : "text-muted-foreground/60"
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full font-medium text-sm transition-colors ${
                        isCompleted
                          ? "bg-primary text-primary-foreground"
                          : isCurrent
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isCompleted ? <Check className="h-4 w-4" /> : s.number}
                    </div>
                    <span className={isCurrent ? "font-medium" : ""}>
                      {s.label}
                    </span>
                  </div>

                  {/* Connector line */}
                  {index < steps.length - 1 && (
                    <div
                      className={`absolute top-[48px] left-[31px] h-4 w-0.5 transition-colors ${
                        isCompleted ? "bg-primary" : "bg-muted"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border bg-background p-4">
            <h4 className="mb-2 font-medium">Need help?</h4>
            <p className="mb-3 text-muted-foreground text-sm">
              Our support team is here to assist you with the setup process.
            </p>
            <Link className="text-primary text-sm hover:underline" to="/">
              Contact support →
            </Link>
          </div>

          <p className="text-center text-muted-foreground text-xs">
            &copy; {new Date().getFullYear()} Drovi. All rights reserved.
          </p>
        </div>
      </div>

      {/* Right side - Content */}
      <div className="flex flex-col">
        {/* Mobile header */}
        <div className="flex items-center justify-between border-b p-4 lg:hidden">
          <Link className="flex items-center gap-2 font-semibold" to="/">
            <img
              alt="Drovi"
              className="h-7 w-7 rounded-lg"
              src="/logo-dark.jpg"
            />
            <span>Drovi</span>
          </Link>
          <span className="text-muted-foreground text-sm">
            Step {step} of 4
          </span>
        </div>

        {/* Mobile progress bar */}
        <div className="border-b bg-muted/30 px-4 py-3 lg:hidden">
          <div className="flex gap-2">
            {steps.map((s) => (
              <div
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  s.number <= step ? "bg-primary" : "bg-muted"
                }`}
                key={s.number}
              />
            ))}
          </div>
        </div>

        {/* Main content */}
        <div className="flex flex-1 items-center justify-center p-6 lg:p-10">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </div>
    </div>
  );
}
