import { ReactNode } from "react";

interface SlideLayoutProps {
  children: ReactNode;
  className?: string;
  mobileAlign?: "top" | "center";
}

const SlideLayout = ({ children, className = "", mobileAlign = "top" }: SlideLayoutProps) => {
  const alignmentClass =
    mobileAlign === "center" ? "items-center" : "items-start md:items-center";

  return (
    <section
      className={`relative h-[100dvh] min-h-screen w-full overflow-hidden ${className}`}
      style={{
        background: "radial-gradient(ellipse at center, hsl(150 25% 13%) 0%, hsl(150 30% 6%) 70%, hsl(150 35% 3%) 100%)",
      }}
    >
      {/* Subtle vignette overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.4) 100%)",
        }}
      />
      <div
        data-slide-scroll="true"
        className="relative z-10 h-full w-full overflow-y-auto overflow-x-hidden"
      >
        <div className={`safe-area-y mx-auto flex min-h-full w-full max-w-7xl justify-center px-4 sm:px-6 md:px-16 lg:px-24 ${alignmentClass}`}>
          <div className="w-full">{children}</div>
        </div>
      </div>
    </section>
  );
};

export default SlideLayout;
