// =============================================================================
// USE ANALYTICS HOOK
// =============================================================================
//
// React hook for analytics tracking with automatic page views and user identification.
//

import { useLocation } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import {
  type AnalyticsEvent,
  type AnalyticsEventProperties,
  identifyUser,
  initAnalytics,
  isAnalyticsEnabled,
  resetUser,
  setOrganization,
  track,
  trackPageView,
} from "@/lib/analytics";
import { authClient } from "@/lib/auth-client";

// =============================================================================
// HOOK
// =============================================================================

interface UseAnalyticsOptions {
  /** Enable automatic page view tracking */
  autoTrackPageViews?: boolean;
  /** Enable automatic user identification */
  autoIdentify?: boolean;
}

interface UseAnalyticsReturn {
  /** Track an analytics event */
  track: (event: AnalyticsEvent, properties?: AnalyticsEventProperties) => void;
  /** Track a page view manually */
  trackPageView: (path?: string, properties?: Record<string, unknown>) => void;
  /** Check if analytics is enabled */
  isEnabled: boolean;
}

/**
 * React hook for analytics tracking.
 *
 * @example
 * function MyComponent() {
 *   const { track } = useAnalytics();
 *
 *   const handleClick = () => {
 *     track('button_clicked', { buttonName: 'submit' });
 *   };
 *
 *   return <button onClick={handleClick}>Submit</button>;
 * }
 */
export function useAnalytics(
  options: UseAnalyticsOptions = {}
): UseAnalyticsReturn {
  const { autoTrackPageViews = true, autoIdentify = true } = options;
  const location = useLocation();
  const { data: session } = authClient.useSession();
  const lastPathRef = useRef<string>("");
  const identifiedRef = useRef(false);

  // Initialize analytics on mount
  useEffect(() => {
    initAnalytics();
  }, []);

  // Auto-track page views on route changes
  useEffect(() => {
    if (!autoTrackPageViews) return;

    const currentPath = location.pathname;
    if (currentPath !== lastPathRef.current) {
      lastPathRef.current = currentPath;
      trackPageView(currentPath);
    }
  }, [location.pathname, autoTrackPageViews]);

  // Auto-identify user on session change
  useEffect(() => {
    if (!autoIdentify) return;

    const user = session?.user;
    const activeOrgId = session?.session?.activeOrganizationId;

    if (user && !identifiedRef.current) {
      identifyUser({
        id: user.id,
        organizationId: activeOrgId ?? undefined,
        createdAt: user.createdAt?.toString(),
      });

      if (activeOrgId) {
        setOrganization(activeOrgId);
      }

      identifiedRef.current = true;
    } else if (!user && identifiedRef.current) {
      resetUser();
      identifiedRef.current = false;
    }
  }, [session?.user?.id, session?.session?.activeOrganizationId, autoIdentify]);

  // Memoized track function with organization context
  const trackWithContext = useCallback(
    (event: AnalyticsEvent, properties?: AnalyticsEventProperties) => {
      const activeOrgId = session?.session?.activeOrganizationId;
      track(event, {
        ...properties,
        organizationId: properties?.organizationId ?? activeOrgId ?? undefined,
      });
    },
    [session?.session?.activeOrganizationId]
  );

  // Memoized page view function
  const trackPageViewManual = useCallback(
    (path?: string, properties?: Record<string, unknown>) => {
      trackPageView(path ?? location.pathname, properties);
    },
    [location.pathname]
  );

  return {
    track: trackWithContext,
    trackPageView: trackPageViewManual,
    isEnabled: isAnalyticsEnabled(),
  };
}

// =============================================================================
// CONVENIENCE HOOKS
// =============================================================================

/**
 * Hook to track a specific event when a component mounts.
 *
 * @example
 * function FeaturePage() {
 *   useTrackOnMount('feature_page_viewed', { feature: 'commitments' });
 *   return <div>Feature content</div>;
 * }
 */
export function useTrackOnMount(
  event: AnalyticsEvent,
  properties?: AnalyticsEventProperties
): void {
  const { track: trackEvent } = useAnalytics({ autoTrackPageViews: false });

  useEffect(() => {
    trackEvent(event, properties);
    // Only track once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Hook to track time spent on a page/component.
 *
 * @example
 * function ArticlePage() {
 *   useTrackTimeSpent('article_read_time', { articleId: '123' });
 *   return <article>Content</article>;
 * }
 */
export function useTrackTimeSpent(
  event: AnalyticsEvent,
  properties?: AnalyticsEventProperties
): void {
  const { track: trackEvent } = useAnalytics({ autoTrackPageViews: false });
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    startTimeRef.current = Date.now();

    return () => {
      const timeSpentMs = Date.now() - startTimeRef.current;
      trackEvent(event, {
        ...properties,
        timeSpentMs,
        timeSpentSeconds: Math.round(timeSpentMs / 1000),
      });
    };
    // Only track on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// =============================================================================
// EXPORTS
// =============================================================================

export default useAnalytics;
