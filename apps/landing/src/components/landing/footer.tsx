import Link from "next/link";

const footerLinks = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Security", href: "/security" },
  { label: "Contact", href: "/contact" },
];

export function Footer() {
  return (
    <footer className="relative px-6 py-10 md:py-16">
      {/* Top border with gradient */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />

      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row md:gap-8">
          {/* Logo */}
          <Link
            className="font-semibold text-[18px] text-foreground leading-[1.3] tracking-[-1.4px] transition-opacity hover:opacity-80 md:text-[20px] md:tracking-[-1.6px]"
            href="/"
          >
            Drovi
          </Link>

          {/* Links */}
          <div className="flex flex-wrap items-center justify-center gap-4 md:gap-8">
            {footerLinks.map((link) => (
              <Link
                className="text-[13px] text-foreground/40 transition-colors hover:text-foreground md:text-[14px]"
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-8 text-center text-[12px] text-foreground/30 md:mt-12 md:text-[13px]">
          © {new Date().getFullYear()} Drovi. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
