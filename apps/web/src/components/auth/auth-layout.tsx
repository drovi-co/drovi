import { Link } from "@tanstack/react-router";
import { useT } from "@/i18n";

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  description: string;
}

export function AuthLayout({ children, title, description }: AuthLayoutProps) {
  const t = useT();
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-2">
      {/* Left side - Branding */}
      <div className="hidden flex-col justify-between border-r border-border bg-shell p-10 text-shell-foreground lg:flex">
        <Link
          className="flex items-center gap-2 font-semibold text-lg"
          to="/"
        >
          <img
            alt="Drovi"
            className="h-8 w-8 rounded-lg"
            height={32}
            src="/drovi-old-money.svg"
            width={32}
          />
          <span>{t("common.app")}</span>
        </Link>

        <div className="space-y-6">
          <blockquote className="space-y-4">
            <p className="text-muted-foreground text-xl leading-relaxed">
              {t("auth.testimonial.quote")}
            </p>
            <footer className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground text-sm">
                MK
              </div>
              <div>
                <div className="font-medium">{t("auth.testimonial.name")}</div>
                <div className="text-muted-foreground text-sm">
                  {t("auth.testimonial.role")}
                </div>
              </div>
            </footer>
          </blockquote>
        </div>

        <div className="flex items-center gap-4 text-muted-foreground text-sm">
          <span>
            &copy; {new Date().getFullYear()} {t("common.app")}
          </span>
          <span className="text-border">&middot;</span>
          <Link className="transition-colors hover:text-foreground" to="/">
            {t("auth.links.privacy")}
          </Link>
          <span className="text-border">&middot;</span>
          <Link className="transition-colors hover:text-foreground" to="/">
            {t("auth.links.terms")}
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
                height={32}
                src="/drovi-old-money.svg"
                width={32}
              />
              <span>{t("common.app")}</span>
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
