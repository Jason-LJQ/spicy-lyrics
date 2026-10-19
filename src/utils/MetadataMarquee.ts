import { onAnimationFrame } from "./AnimationFrameLoop.ts";

/** Animate overflowing metadata only, on the shared, frame-capped clock. */
export function observeMetadataMarquees(page: HTMLElement): () => void {
  const containers = [
    ...page.querySelectorAll<HTMLElement>(
      ".NowBar .Metadata .SongName, .NowBar .Metadata .Artists"
    ),
  ];
  const animations = new Map<
    HTMLElement,
    { distance: number; startedAt: number; transform: string; original: string }
  >();
  let unsubscribe: (() => void) | null = null;
  const render = (timestamp: number) => {
    for (const [span, state] of animations) {
      const elapsed = Math.max(0, timestamp - state.startedAt);
      const cycle = elapsed / 25000;
      const phase = Math.floor(cycle) % 2 ? 1 - (cycle % 1) : cycle % 1;
      const progress = Math.max(0, Math.min(1, (phase - 0.1) / 0.8));
      const offset = Math.round(-state.distance * progress * 100) / 100;
      const transform = `translateX(${offset}px)`;
      if (state.transform !== transform) {
        span.style.transform = transform;
        state.transform = transform;
      }
    }
  };
  const motion = page.ownerDocument.defaultView!.matchMedia("(prefers-reduced-motion: reduce)");
  let spans: HTMLElement[] = [];
  let disposed = false;
  let frame: number | null = null;
  let frameWindow: Window | null = null;

  const stop = (span: HTMLElement) => {
    const state = animations.get(span);
    if (state) span.style.transform = state.original;
    animations.delete(span);
    if (animations.size === 0) {
      unsubscribe?.();
      unsubscribe = null;
    }
  };
  const update = () => {
    frame = null;
    // NowBar replaces the artist wrapper when the track or fullscreen layout changes.
    const next = containers.flatMap((container) => [
      ...container.querySelectorAll<HTMLElement>(":scope > span"),
    ]);
    for (const span of spans) {
      if (!next.includes(span)) {
        resize.unobserve(span);
        stop(span);
      }
    }
    for (const span of next) {
      if (!spans.includes(span)) resize.observe(span);
    }
    spans = next;
    // Read every box before starting or cancelling animations.
    const distances = spans.map((span) => {
      const container = span.parentElement;
      return container && span.isConnected && container.clientWidth > 0 && !motion.matches
        ? Math.max(0, span.scrollWidth - container.clientWidth)
        : 0;
    });
    spans.forEach((span, index) => {
      const distance = distances[index];
      if (distance <= 1) {
        stop(span);
      } else if (animations.get(span)?.distance !== distance) {
        stop(span);
        animations.set(span, {
          distance,
          startedAt: performance.now(),
          transform: "",
          original: span.style.transform,
        });
        unsubscribe ??= onAnimationFrame(render);
      }
    });
  };

  const schedule = () => {
    if (disposed || frame !== null) return;
    frameWindow = page.ownerDocument.defaultView;
    if (frameWindow) frame = frameWindow.requestAnimationFrame(update);
  };
  const resize = new ResizeObserver(schedule);
  const text = new MutationObserver(schedule);
  for (const container of containers) {
    resize.observe(container);
    text.observe(container, { childList: true, characterData: true, subtree: true });
  }
  // Compact/fullscreen/font switches can change the clipping box without changing the text.
  const layout = new MutationObserver(schedule);
  layout.observe(page, { attributes: true, attributeFilter: ["class"] });
  const fonts = page.ownerDocument.fonts;
  fonts.addEventListener("loadingdone", schedule);
  motion.addEventListener("change", schedule);
  void fonts.ready.then(schedule);
  schedule();

  return () => {
    disposed = true;
    if (frame !== null) frameWindow?.cancelAnimationFrame(frame);
    resize.disconnect();
    text.disconnect();
    layout.disconnect();
    fonts.removeEventListener("loadingdone", schedule);
    motion.removeEventListener("change", schedule);
    for (const span of animations.keys()) stop(span);
  };
}
