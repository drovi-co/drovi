// =============================================================================
// TODAY DASHBOARD PAGE - ART.DAY INSPIRED DESIGN
// =============================================================================
//
// A stunning, immersive greeting page that makes you feel present.
// Large centered text with inline app icons showing your day at a glance.
//

import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { trpc } from "@/utils/trpc";

// =============================================================================
// ROUTE DEFINITION
// =============================================================================

export const Route = createFileRoute("/dashboard/today/")({
  component: TodayPage,
});

// =============================================================================
// WEATHER & LOCATION HOOKS
// =============================================================================

interface WeatherData {
  temperature: number;
  condition: "sunny" | "partly-cloudy" | "cloudy" | "rainy" | "snowy" | "stormy";
  description: string;
}

interface LocationData {
  city: string;
  country: string;
  latitude: number;
  longitude: number;
}

function useLocation() {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          // Reverse geocoding using OpenStreetMap Nominatim
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
          );
          const data = await response.json();
          setLocation({
            city: data.address?.city || data.address?.town || data.address?.village || "Unknown",
            country: data.address?.country || "",
            latitude,
            longitude,
          });
        } catch {
          setLocation({
            city: "your location",
            country: "",
            latitude,
            longitude,
          });
        }
        setLoading(false);
      },
      () => {
        setLoading(false);
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }
    );
  }, []);

  return { location, loading };
}

function useWeather(latitude?: number, longitude?: number) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (latitude === undefined || longitude === undefined) {
      setLoading(false);
      return;
    }

    const fetchWeather = async () => {
      try {
        // Using Open-Meteo API (free, no API key required)
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`
        );
        const data = await response.json();

        const weatherCode = data.current?.weather_code ?? 0;
        const temp = Math.round(data.current?.temperature_2m ?? 0);

        // Map weather codes to conditions
        let condition: WeatherData["condition"] = "sunny";
        let description = "sunny";

        if (weatherCode === 0) {
          condition = "sunny";
          description = "sunny";
        } else if (weatherCode <= 3) {
          condition = "partly-cloudy";
          description = "partly cloudy";
        } else if (weatherCode <= 49) {
          condition = "cloudy";
          description = "cloudy";
        } else if (weatherCode <= 69) {
          condition = "rainy";
          description = "rainy";
        } else if (weatherCode <= 79) {
          condition = "snowy";
          description = "snowy";
        } else {
          condition = "stormy";
          description = "stormy";
        }

        setWeather({ temperature: temp, condition, description });
      } catch {
        setWeather(null);
      }
      setLoading(false);
    };

    fetchWeather();
  }, [latitude, longitude]);

  return { weather, loading };
}

// =============================================================================
// APP ICON COMPONENT - iOS Style
// =============================================================================

interface AppIconProps {
  type: "clock" | "weather" | "mail" | "calendar" | "map" | "commitment" | "decision" | "meeting";
  weatherCondition?: WeatherData["condition"];
  className?: string;
  size?: "sm" | "md" | "lg";
}

function AppIcon({ type, weatherCondition, className, size = "md" }: AppIconProps) {
  const sizeClasses = {
    sm: "w-8 h-8",
    md: "w-10 h-10",
    lg: "w-12 h-12",
  };

  const iconStyles: Record<string, { bg: string; shadow: string }> = {
    clock: {
      bg: "linear-gradient(180deg, #FFFFFF 0%, #F5F5F5 100%)",
      shadow: "rgba(0, 0, 0, 0.15)",
    },
    weather: {
      bg: "linear-gradient(180deg, #5AC8FA 0%, #34AADC 100%)",
      shadow: "rgba(52, 170, 220, 0.4)",
    },
    mail: {
      bg: "linear-gradient(180deg, #5AC8FA 0%, #007AFF 100%)",
      shadow: "rgba(0, 122, 255, 0.4)",
    },
    calendar: {
      bg: "linear-gradient(180deg, #FF3B30 0%, #FF2D55 100%)",
      shadow: "rgba(255, 59, 48, 0.4)",
    },
    map: {
      bg: "linear-gradient(180deg, #FFFFFF 0%, #F0F0F0 100%)",
      shadow: "rgba(0, 0, 0, 0.12)",
    },
    commitment: {
      bg: "linear-gradient(180deg, #FF9500 0%, #FF6B00 100%)",
      shadow: "rgba(255, 149, 0, 0.4)",
    },
    decision: {
      bg: "linear-gradient(180deg, #AF52DE 0%, #9B4DCA 100%)",
      shadow: "rgba(175, 82, 222, 0.4)",
    },
    meeting: {
      bg: "linear-gradient(180deg, #FFFFFF 0%, #F8F8F8 100%)",
      shadow: "rgba(0, 0, 0, 0.1)",
    },
  };

  const style = iconStyles[type];

  const renderIcon = () => {
    switch (type) {
      case "clock":
        return (
          <div className="w-full h-full relative bg-white rounded-[22%]">
            <svg viewBox="0 0 40 40" className="w-full h-full">
              <circle cx="20" cy="20" r="16" fill="white" stroke="#E5E5E5" strokeWidth="0.5" />
              {[...Array(12)].map((_, i) => {
                const angle = (i * 30 - 90) * (Math.PI / 180);
                const x1 = 20 + 12 * Math.cos(angle);
                const y1 = 20 + 12 * Math.sin(angle);
                const x2 = 20 + 14 * Math.cos(angle);
                const y2 = 20 + 14 * Math.sin(angle);
                return (
                  <line
                    key={i}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="#1C1C1E"
                    strokeWidth={i % 3 === 0 ? "1.5" : "0.8"}
                  />
                );
              })}
              <line x1="20" y1="20" x2="20" y2="11" stroke="#1C1C1E" strokeWidth="2" strokeLinecap="round" />
              <line x1="20" y1="20" x2="28" y2="20" stroke="#1C1C1E" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="20" y1="20" x2="20" y2="8" stroke="#FF3B30" strokeWidth="0.8" strokeLinecap="round" />
              <circle cx="20" cy="20" r="1.5" fill="#1C1C1E" />
            </svg>
          </div>
        );

      case "weather":
        // Dynamic weather icon based on condition
        const renderWeatherIcon = () => {
          switch (weatherCondition) {
            case "sunny":
              return (
                <svg viewBox="0 0 40 40" className="w-full h-full p-1.5">
                  <circle cx="20" cy="20" r="8" fill="#FFD60A" />
                  <g stroke="#FFD60A" strokeWidth="2" strokeLinecap="round">
                    <line x1="20" y1="4" x2="20" y2="8" />
                    <line x1="20" y1="32" x2="20" y2="36" />
                    <line x1="4" y1="20" x2="8" y2="20" />
                    <line x1="32" y1="20" x2="36" y2="20" />
                    <line x1="8.8" y1="8.8" x2="11.6" y2="11.6" />
                    <line x1="28.4" y1="28.4" x2="31.2" y2="31.2" />
                    <line x1="8.8" y1="31.2" x2="11.6" y2="28.4" />
                    <line x1="28.4" y1="11.6" x2="31.2" y2="8.8" />
                  </g>
                </svg>
              );
            case "partly-cloudy":
              return (
                <svg viewBox="0 0 40 40" className="w-full h-full p-1.5">
                  <circle cx="28" cy="14" r="8" fill="#FFD60A" />
                  <path
                    d="M10 28c-3.3 0-6-2.7-6-6s2.7-6 6-6c.5-3.9 3.8-7 7.8-7 3.5 0 6.5 2.3 7.6 5.5.5-.1 1-.2 1.6-.2 3.3 0 6 2.7 6 6s-2.7 6-6 6H10z"
                    fill="white"
                  />
                </svg>
              );
            case "cloudy":
              return (
                <svg viewBox="0 0 40 40" className="w-full h-full p-1.5">
                  <path
                    d="M10 30c-4 0-7-3-7-7s3-7 7-7c.6-4.5 4.4-8 9-8 4 0 7.5 2.6 8.8 6.3.6-.1 1.2-.2 1.8-.2 4 0 7 3 7 7s-3 7-7 7H10z"
                    fill="white"
                  />
                </svg>
              );
            case "rainy":
              return (
                <svg viewBox="0 0 40 40" className="w-full h-full p-1">
                  <path
                    d="M10 24c-3.3 0-6-2.2-6-5s2.7-5 6-5c.5-3.2 3.8-5.8 7.8-5.8 3.5 0 6.5 1.9 7.6 4.5.5-.1 1-.2 1.6-.2 3.3 0 6 2.2 6 5s-2.7 5-6 5H10z"
                    fill="white"
                  />
                  <g fill="#5AC8FA">
                    <circle cx="12" cy="30" r="1.5" />
                    <circle cx="20" cy="32" r="1.5" />
                    <circle cx="28" cy="30" r="1.5" />
                    <circle cx="16" cy="35" r="1.5" />
                    <circle cx="24" cy="36" r="1.5" />
                  </g>
                </svg>
              );
            case "snowy":
              return (
                <svg viewBox="0 0 40 40" className="w-full h-full p-1">
                  <path
                    d="M10 24c-3.3 0-6-2.2-6-5s2.7-5 6-5c.5-3.2 3.8-5.8 7.8-5.8 3.5 0 6.5 1.9 7.6 4.5.5-.1 1-.2 1.6-.2 3.3 0 6 2.2 6 5s-2.7 5-6 5H10z"
                    fill="white"
                  />
                  <g fill="white" stroke="#B0D4F1" strokeWidth="0.5">
                    <circle cx="12" cy="30" r="2" />
                    <circle cx="20" cy="32" r="2" />
                    <circle cx="28" cy="30" r="2" />
                    <circle cx="16" cy="36" r="2" />
                    <circle cx="24" cy="35" r="2" />
                  </g>
                </svg>
              );
            case "stormy":
              return (
                <svg viewBox="0 0 40 40" className="w-full h-full p-1">
                  <path
                    d="M10 22c-3.3 0-6-2.2-6-5s2.7-5 6-5c.5-3.2 3.8-5.8 7.8-5.8 3.5 0 6.5 1.9 7.6 4.5.5-.1 1-.2 1.6-.2 3.3 0 6 2.2 6 5s-2.7 5-6 5H10z"
                    fill="#8E8E93"
                  />
                  <path d="M22 24l-4 8h6l-4 8" fill="none" stroke="#FFD60A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              );
            default:
              return (
                <svg viewBox="0 0 40 40" className="w-full h-full p-1.5">
                  <circle cx="28" cy="14" r="8" fill="#FFD60A" />
                  <path
                    d="M10 28c-3.3 0-6-2.7-6-6s2.7-6 6-6c.5-3.9 3.8-7 7.8-7 3.5 0 6.5 2.3 7.6 5.5.5-.1 1-.2 1.6-.2 3.3 0 6 2.7 6 6s-2.7 6-6 6H10z"
                    fill="white"
                  />
                </svg>
              );
          }
        };
        return <div className="w-full h-full flex items-center justify-center">{renderWeatherIcon()}</div>;

      case "mail":
        return (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 40 40" className="w-full h-full p-2">
              <rect x="4" y="10" width="32" height="20" rx="3" fill="white" />
              <path d="M4 13l16 10 16-10" fill="none" stroke="#007AFF" strokeWidth="2" />
            </svg>
          </div>
        );

      case "calendar":
        const today = new Date();
        return (
          <div className="w-full h-full flex flex-col items-center justify-start overflow-hidden rounded-[22%]">
            <div className="w-full bg-[#FF3B30] text-white text-[6px] font-semibold text-center py-0.5 uppercase tracking-wider">
              {format(today, "EEE")}
            </div>
            <div className="flex-1 w-full bg-white flex items-center justify-center">
              <span className="text-[18px] font-light text-[#1C1C1E]">{format(today, "d")}</span>
            </div>
          </div>
        );

      case "map":
        return (
          <div className="w-full h-full relative overflow-hidden rounded-[22%] bg-[#F0EDE5]">
            <svg viewBox="0 0 40 40" className="w-full h-full">
              <path d="M0 20 Q10 15, 20 20 T40 20" fill="none" stroke="#D4D0C8" strokeWidth="2" />
              <path d="M10 0 Q15 20, 10 40" fill="none" stroke="#D4D0C8" strokeWidth="1.5" />
              <path d="M30 0 Q25 15, 30 40" fill="none" stroke="#D4D0C8" strokeWidth="1.5" />
              <circle cx="20" cy="18" r="4" fill="#007AFF" />
              <circle cx="20" cy="18" r="1.5" fill="white" />
            </svg>
            <div className="absolute top-1 right-1 w-4 h-4 bg-white rounded-full flex items-center justify-center shadow-sm">
              <span className="text-[6px] font-bold text-gray-600">N</span>
            </div>
          </div>
        );

      case "commitment":
        return (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 40 40" className="w-full h-full p-1.5">
              <circle cx="20" cy="20" r="16" fill="none" stroke="white" strokeWidth="2.5" />
              <path d="M12 20l6 6 12-12" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        );

      case "decision":
        return (
          <div className="w-full h-full flex items-center justify-center">
            <svg viewBox="0 0 40 40" className="w-full h-full p-2">
              <path
                d="M20 4l4.9 9.9 10.9 1.6-7.9 7.7 1.9 10.8L20 29l-9.8 5.1 1.9-10.8-7.9-7.7 10.9-1.6L20 4z"
                fill="white"
              />
            </svg>
          </div>
        );

      case "meeting":
        return (
          <div className="w-full h-full flex flex-col overflow-hidden rounded-[22%] bg-white p-1">
            <div className="flex items-center gap-0.5">
              <div className="w-0.5 h-3 bg-purple-500 rounded-full" />
              <span className="text-[5px] font-semibold text-gray-800 truncate">Meeting</span>
            </div>
            <span className="text-[5px] text-blue-500 mt-0.5">10:00</span>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-[22%] shrink-0 align-middle mx-1.5 overflow-hidden",
        "transform hover:scale-110 transition-transform duration-200",
        sizeClasses[size],
        className
      )}
      style={{
        background: style.bg,
        boxShadow: `0 4px 12px ${style.shadow}, 0 2px 4px rgba(0, 0, 0, 0.08)`,
      }}
    >
      {renderIcon()}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

function TodayPage() {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const { data: activeOrg, isPending: orgLoading } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? "";

  // Current time state
  const [currentTime, setCurrentTime] = useState(new Date());

  // Location and weather
  const { location, loading: locationLoading } = useLocation();
  const { weather, loading: weatherLoading } = useWeather(location?.latitude, location?.longitude);

  // Update time every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // ==========================================================================
  // DATA FETCHING
  // ==========================================================================

  // Unread emails count
  const { data: unreadData } = useQuery({
    ...trpc.threads.getUnreadCount.queryOptions({}),
  });

  // Commitment stats
  const { data: commitmentStats } = useQuery({
    ...trpc.commitments.getStats.queryOptions({ organizationId }),
    enabled: !!organizationId,
  });

  // Decision stats
  const { data: decisionStats } = useQuery({
    ...trpc.decisions.getStats.queryOptions({ organizationId }),
    enabled: !!organizationId,
  });

  // ==========================================================================
  // DERIVED VALUES
  // ==========================================================================

  const dayName = format(currentTime, "EEEE");
  const formattedTime = format(currentTime, "h:mm a");
  const formattedDate = format(currentTime, "MMMM d");

  const unreadEmails = unreadData?.count ?? 0;
  const overdueCount = commitmentStats?.overdue ?? 0;
  const pendingCount = commitmentStats?.pending ?? 0;
  const totalCommitments = overdueCount + pendingCount;
  const decisionsThisWeek = decisionStats?.thisWeek ?? 0;

  // ==========================================================================
  // LOADING STATE
  // ==========================================================================

  if (orgLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[#0a0a0a]">
        <div className="animate-pulse text-white/60 text-2xl font-semibold">Loading...</div>
      </div>
    );
  }

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <div className="h-full w-full relative overflow-hidden bg-[#0a0a0a]">
      {/* Sky gradient - full coverage */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(180deg, #4A7AB0 0%, #5B8BC5 20%, #7BA8D5 35%, #A8C5E0 50%, #D0C5B8 65%, #E0B8A5 80%, #D8A890 95%, #C89080 100%)",
        }}
      />

      {/* Vignette overlay - very gradual fade to black */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 150% 120% at 50% 50%,
              transparent 0%,
              transparent 30%,
              rgba(10, 10, 10, 0.1) 45%,
              rgba(10, 10, 10, 0.3) 55%,
              rgba(10, 10, 10, 0.6) 65%,
              rgba(10, 10, 10, 0.85) 75%,
              rgba(10, 10, 10, 0.95) 85%,
              rgba(10, 10, 10, 1) 95%
            )
          `,
        }}
      />

      {/* Top edge fade */}
      <div
        className="absolute inset-x-0 top-0 h-32 pointer-events-none"
        style={{
          background: "linear-gradient(to bottom, rgba(10, 10, 10, 1) 0%, rgba(10, 10, 10, 0.8) 30%, rgba(10, 10, 10, 0.4) 60%, transparent 100%)",
        }}
      />

      {/* Bottom edge fade */}
      <div
        className="absolute inset-x-0 bottom-0 h-32 pointer-events-none"
        style={{
          background: "linear-gradient(to top, rgba(10, 10, 10, 1) 0%, rgba(10, 10, 10, 0.8) 30%, rgba(10, 10, 10, 0.4) 60%, transparent 100%)",
        }}
      />

      {/* Left edge fade */}
      <div
        className="absolute inset-y-0 left-0 w-32 pointer-events-none"
        style={{
          background: "linear-gradient(to right, rgba(10, 10, 10, 1) 0%, rgba(10, 10, 10, 0.8) 30%, rgba(10, 10, 10, 0.4) 60%, transparent 100%)",
        }}
      />

      {/* Right edge fade */}
      <div
        className="absolute inset-y-0 right-0 w-32 pointer-events-none"
        style={{
          background: "linear-gradient(to left, rgba(10, 10, 10, 1) 0%, rgba(10, 10, 10, 0.8) 30%, rgba(10, 10, 10, 0.4) 60%, transparent 100%)",
        }}
      />

      {/* Main content */}
      <div className="relative z-10 h-full flex flex-col items-center justify-center px-8">
        {/* Large centered text */}
        <div className="max-w-5xl text-center">
          {/* Main greeting - Happy [DayName]! */}
          <h1
            className="text-5xl md:text-6xl lg:text-7xl font-bold text-white leading-tight tracking-tight"
            style={{
              textShadow: "0 4px 30px rgba(0, 0, 0, 0.25), 0 2px 10px rgba(0, 0, 0, 0.15)",
            }}
          >
            Happy {dayName}!
          </h1>

          {/* Time and weather line */}
          <p
            className="mt-6 text-3xl md:text-4xl lg:text-[2.75rem] font-semibold leading-relaxed"
            style={{
              textShadow: "0 3px 20px rgba(0, 0, 0, 0.2)",
            }}
          >
            <span className="text-white/70">It's</span>{" "}
            <span className="inline-flex items-center">
              <AppIcon type="clock" size="lg" />
              <span className="text-white font-bold">{formattedTime}</span>
            </span>{" "}
            <span className="text-white/70">and</span>{" "}
            <span className="inline-flex items-center">
              <AppIcon type="weather" size="lg" weatherCondition={weather?.condition} />
              <span className="text-white">
                {weatherLoading ? "..." : weather?.description ?? "pleasant"}
              </span>
            </span>
          </p>

          {/* Location line */}
          <p
            className="mt-2 text-3xl md:text-4xl lg:text-[2.75rem] font-semibold leading-relaxed"
            style={{
              textShadow: "0 3px 20px rgba(0, 0, 0, 0.2)",
            }}
          >
            <span className="text-white/70">in</span>{" "}
            <span className="inline-flex items-center">
              <AppIcon type="map" size="lg" />
              <span className="text-white">
                {locationLoading ? "..." : location?.city ?? "your area"}
              </span>
            </span>
            <span className="text-white/70">.</span>
          </p>

          {/* Stats line - Clear breakdown */}
          <p
            className="mt-10 text-2xl md:text-3xl lg:text-4xl font-medium leading-relaxed"
            style={{
              textShadow: "0 2px 15px rgba(0, 0, 0, 0.15)",
            }}
          >
            <span className="text-white/60">You have</span>{" "}
            <button
              onClick={() => navigate({ to: "/dashboard/email" })}
              className="inline-flex items-center hover:scale-105 transition-transform cursor-pointer"
            >
              <AppIcon type="mail" size="lg" />
              <span className="text-white font-bold">{unreadEmails}</span>
            </button>{" "}
            <span className="text-white/60">unread emails,</span>{" "}
            <button
              onClick={() => navigate({ to: "/dashboard/commitments" })}
              className="inline-flex items-center hover:scale-105 transition-transform cursor-pointer"
            >
              <AppIcon type="commitment" size="lg" />
              <span className="text-white font-bold">{totalCommitments}</span>
            </button>{" "}
            <span className="text-white/60">commitments</span>
          </p>

          <p
            className="mt-2 text-2xl md:text-3xl lg:text-4xl font-medium leading-relaxed"
            style={{
              textShadow: "0 2px 15px rgba(0, 0, 0, 0.15)",
            }}
          >
            <span className="text-white/60">and</span>{" "}
            <button
              onClick={() => navigate({ to: "/dashboard/decisions" })}
              className="inline-flex items-center hover:scale-105 transition-transform cursor-pointer"
            >
              <AppIcon type="decision" size="lg" />
              <span className="text-white font-bold">{decisionsThisWeek}</span>
            </button>{" "}
            <span className="text-white/60">{decisionsThisWeek === 1 ? "decision" : "decisions"} this week.</span>
          </p>
        </div>

        {/* Subtle date at bottom */}
        <div
          className="absolute bottom-8 text-white/40 text-base font-medium tracking-wide"
          style={{
            textShadow: "0 1px 4px rgba(0, 0, 0, 0.2)",
          }}
        >
          {formattedDate}
        </div>
      </div>
    </div>
  );
}
