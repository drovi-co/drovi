"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useSession } from "@/lib/auth-client";
import { cn, getAppUrl } from "@/lib/utils";

const navLinks = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
];

interface NavigationProps {
  onRequestAccess?: () => void;
}

export function Navigation({ onRequestAccess }: NavigationProps) {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav className="absolute top-0 left-0 z-50 w-full">
      {/* Desktop Navigation - pixel perfect from Figma */}
      <div className="mx-auto hidden w-full max-w-[1440px] items-center justify-center gap-[60px] overflow-clip rounded-[100px] py-[10px] pr-[10px] pl-[20px] backdrop-blur-[25px] md:flex">
        {/* Logo */}
        <div className="flex shrink-0 items-center">
          <Link
            className="font-semibold text-[20px] text-white leading-[1.3] tracking-[-1.6px]"
            href="/"
          >
            Drovi
          </Link>
        </div>

        {/* Nav Links */}
        <div className="flex items-center gap-[32px]">
          {navLinks.map((link) => (
            <Link
              className="font-normal text-[14px] text-white leading-[1.3] tracking-[-0.56px] transition-opacity hover:opacity-80"
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Auth Buttons */}
        <div className="flex shrink-0 items-center gap-[8px]">
          {isAuthenticated ? (
            <a
              className="flex items-center justify-center rounded-[80px] px-[20px] py-[15px] font-semibold text-[14px] text-white leading-[1.3] tracking-[-0.56px] backdrop-blur-[4px] transition-opacity hover:opacity-80"
              href={getAppUrl("/dashboard")}
            >
              Dashboard
            </a>
          ) : (
            <a
              className="flex items-center justify-center rounded-[80px] px-[20px] py-[15px] font-semibold text-[14px] text-white leading-[1.3] tracking-[-0.56px] backdrop-blur-[4px] transition-opacity hover:opacity-80"
              href={getAppUrl("/login")}
            >
              Log in
            </a>
          )}
          <button
            className="flex items-center justify-center rounded-[80px] bg-white/10 px-[20px] py-[15px] font-medium text-[14px] text-white leading-[1.3] tracking-[-0.56px] backdrop-blur-[4px] transition-colors hover:bg-white/20"
            onClick={onRequestAccess}
            type="button"
          >
            Request Access
          </button>
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="flex items-center justify-between px-4 py-3 md:hidden">
        <Link
          className="font-semibold text-[20px] text-white leading-[1.3] tracking-[-1.6px]"
          href="/"
        >
          Drovi
        </Link>
        <button
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          className="p-2 text-white"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          type="button"
        >
          {mobileMenuOpen ? (
            <X className="h-5 w-5" />
          ) : (
            <Menu className="h-5 w-5" />
          )}
        </button>
      </div>

      {/* Mobile Menu */}
      <div
        className={cn(
          "mx-4 overflow-hidden rounded-2xl bg-black/40 backdrop-blur-[25px] transition-all duration-300 md:hidden",
          mobileMenuOpen
            ? "max-h-80 opacity-100"
            : "pointer-events-none max-h-0 opacity-0"
        )}
      >
        <div className="space-y-4 p-4">
          {navLinks.map((link) => (
            <Link
              className="block py-2 text-[14px] text-white/90 transition-colors hover:text-white"
              href={link.href}
              key={link.href}
              onClick={() => setMobileMenuOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <div className="space-y-2 border-white/10 border-t pt-4">
            {isAuthenticated ? (
              <a
                className="block w-full px-[20px] py-[15px] text-center font-semibold text-[14px] text-white"
                href={getAppUrl("/dashboard")}
              >
                Dashboard
              </a>
            ) : (
              <a
                className="block w-full px-[20px] py-[15px] text-center font-semibold text-[14px] text-white"
                href={getAppUrl("/login")}
              >
                Log in
              </a>
            )}
            <button
              className="block w-full rounded-[80px] bg-white/10 px-[20px] py-[15px] text-center font-medium text-[14px] text-white backdrop-blur-[4px]"
              onClick={() => {
                setMobileMenuOpen(false);
                onRequestAccess?.();
              }}
              type="button"
            >
              Request Access
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
