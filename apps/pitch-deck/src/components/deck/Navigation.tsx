import { useEffect, useState, useCallback } from "react";

interface NavigationProps {
  totalSlides: number;
  currentSlide: number;
  onNavigate: (index: number) => void;
  onNext: () => void;
  onPrev: () => void;
}

const Navigation = ({ totalSlides, currentSlide, onNavigate, onNext, onPrev }: NavigationProps) => {
  const progress = ((currentSlide + 1) / totalSlides) * 100;
  const canGoPrev = currentSlide > 0;
  const canGoNext = currentSlide < totalSlides - 1;

  return (
    <>
      {/* Progress bar */}
      <div className="fixed top-0 left-0 w-full h-[2px] z-50 bg-muted/20">
        <div
          className="h-full bg-gold transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Navigation dots */}
      <nav className="fixed right-4 top-1/2 -translate-y-1/2 z-50 hidden md:flex flex-col gap-3">
        {Array.from({ length: totalSlides }).map((_, i) => (
          <button
            key={i}
            onClick={() => onNavigate(i)}
            className={`w-2.5 h-2.5 rounded-full border border-gold/60 transition-all duration-300 hover:scale-125 ${
              i === currentSlide
                ? "bg-gold scale-110"
                : "bg-transparent hover:bg-gold/30"
            }`}
            aria-label={`Go to slide ${i + 1}`}
          />
        ))}
      </nav>

      {/* Mobile navigation controls */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 px-3 pb-3 md:hidden safe-area-bottom">
        <div className="mx-auto flex max-w-md items-center gap-3 rounded-full border border-gold/20 bg-forest/80 px-3 py-2 backdrop-blur">
          <button
            onClick={onPrev}
            disabled={!canGoPrev}
            className="h-9 w-9 shrink-0 rounded-full border border-gold/30 text-gold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Previous slide"
          >
            {"<"}
          </button>

          <div className="flex flex-1 items-center justify-center gap-1.5 px-1">
            {Array.from({ length: totalSlides }).map((_, i) => (
              <button
                key={i}
                onClick={() => onNavigate(i)}
                className={`h-2 w-2 rounded-full transition-all ${
                  i === currentSlide ? "scale-110 bg-gold" : "bg-gold/35"
                }`}
                aria-label={`Go to slide ${i + 1}`}
              />
            ))}
          </div>

          <button
            onClick={onNext}
            disabled={!canGoNext}
            className="h-9 w-9 shrink-0 rounded-full border border-gold/30 text-gold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Next slide"
          >
            {">"}
          </button>
        </div>
        <p className="mt-2 text-center font-sans text-[11px] uppercase tracking-[0.2em] text-gold/60">
          {currentSlide + 1} / {totalSlides}
        </p>
      </nav>
    </>
  );
};

export default Navigation;

export function useSlideNavigation(totalSlides: number) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const isInteractiveTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return Boolean(
      target.closest("button, a, input, textarea, select, [role='button'], [data-prevent-swipe='true']")
    );
  }, []);

  const canNavigateInDirection = useCallback((direction: "next" | "prev") => {
    const scrollContainer = document.querySelector<HTMLElement>('[data-slide-scroll="true"]');
    if (!scrollContainer) {
      return true;
    }

    const maxScrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
    const nearTop = scrollContainer.scrollTop <= 2;
    const nearBottom = maxScrollTop <= 2 || scrollContainer.scrollTop >= maxScrollTop - 2;

    return direction === "next" ? nearBottom : nearTop;
  }, []);

  const navigateTo = useCallback((index: number) => {
    if (index >= 0 && index < totalSlides) {
      setCurrentSlide(index);
    }
  }, [totalSlides]);

  const next = useCallback(() => {
    setCurrentSlide((prevSlide) => Math.min(prevSlide + 1, totalSlides - 1));
  }, [totalSlides]);

  const prev = useCallback(() => {
    setCurrentSlide((prevSlide) => Math.max(prevSlide - 1, 0));
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [next, prev]);

  useEffect(() => {
    let touchStartX = 0;
    let touchStartY = 0;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
    };

    const onTouchEnd = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartX;
      const deltaY = touch.clientY - touchStartY;

      if (Math.abs(deltaY) < 56 || Math.abs(deltaY) < Math.abs(deltaX)) {
        return;
      }

      if (deltaY < 0) {
        if (canNavigateInDirection("next")) {
          next();
        }
        return;
      }

      if (canNavigateInDirection("prev")) {
        prev();
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [canNavigateInDirection, next, prev]);

  useEffect(() => {
    let lastWheelEventAt = 0;
    let wheelLockedUntil = 0;
    let awaitGestureReset = false;

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 32 || Math.abs(e.deltaY) < Math.abs(e.deltaX)) {
        return;
      }

      const now = Date.now();
      if (isInteractiveTarget(e.target)) {
        return;
      }

      if (now < wheelLockedUntil) {
        e.preventDefault();
        lastWheelEventAt = now;
        return;
      }

      if (awaitGestureReset && now - lastWheelEventAt < 220) {
        e.preventDefault();
        lastWheelEventAt = now;
        return;
      }

      awaitGestureReset = false;

      if (e.deltaY > 0) {
        if (!canNavigateInDirection("next")) {
          return;
        }
        e.preventDefault();
        next();
      } else {
        if (!canNavigateInDirection("prev")) {
          return;
        }
        e.preventDefault();
        prev();
      }

      lastWheelEventAt = now;
      wheelLockedUntil = now + 750;
      awaitGestureReset = true;
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [canNavigateInDirection, isInteractiveTarget, next, prev]);

  useEffect(() => {
    let activePointerId: number | null = null;
    let pointerStartX = 0;
    let pointerStartY = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        return;
      }

      if (e.pointerType === "mouse" && e.button !== 0) {
        return;
      }

      if (isInteractiveTarget(e.target)) {
        return;
      }

      activePointerId = e.pointerId;
      pointerStartX = e.clientX;
      pointerStartY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (activePointerId !== e.pointerId) {
        return;
      }

      activePointerId = null;
      const deltaX = e.clientX - pointerStartX;
      const deltaY = e.clientY - pointerStartY;

      if (Math.abs(deltaY) < 72 || Math.abs(deltaY) < Math.abs(deltaX)) {
        return;
      }

      if (deltaY < 0) {
        if (canNavigateInDirection("next")) {
          next();
        }
        return;
      }

      if (canNavigateInDirection("prev")) {
        prev();
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [canNavigateInDirection, isInteractiveTarget, next, prev]);

  return { currentSlide, navigateTo, next, prev };
}
