import { describe, expect, it } from 'vitest';
import { computeVerticalScrollWheelDelta } from 'foliate-js/paginator.js';

// A vertical book scrolls along its block axis, so in scrolled mode the strip
// only ever overflows horizontally. Chromium does not fold a vertical wheel
// delta onto a horizontal-only axis, so the paginator has to translate the tick
// itself or the book does not move under a mouse wheel at all.
const base = {
  deltaX: 0,
  deltaY: 100,
  deltaMode: 0,
  ctrlKey: false,
  vertical: true,
  scrolled: true,
  rtl: true,
};

const translate = (overrides: Record<string, unknown> = {}) =>
  computeVerticalScrollWheelDelta({ ...base, ...overrides });

describe('computeVerticalScrollWheelDelta', () => {
  it('scrolls a vertical-rl strip forward on a wheel down', () => {
    // RTL strips start at scrollLeft 0 and read forward into negative offsets.
    expect(translate({ deltaY: 100 })).toBe(-100);
    expect(translate({ deltaY: -100 })).toBe(100);
  });

  it('scrolls forward into positive offsets when the strip is LTR', () => {
    expect(translate({ deltaY: 100, rtl: false })).toBe(100);
  });

  it('leaves horizontal books to native scrolling', () => {
    // A horizontal book in scrolled mode scrolls on scrollTop, which the
    // browser already handles; translating would double every tick.
    expect(translate({ vertical: false, rtl: false })).toBeNull();
  });

  it('leaves paginated mode to the page-turn gesture', () => {
    expect(translate({ scrolled: false })).toBeNull();
  });

  it('stands down for pinch zoom (ctrl+wheel)', () => {
    expect(translate({ ctrlKey: true })).toBeNull();
  });

  it('ignores a horizontal-dominant trackpad pan', () => {
    // The browser maps a sideways pan onto the axis natively; consuming it here
    // as well would move the book twice as far per gesture.
    expect(translate({ deltaX: 120, deltaY: 40 })).toBeNull();
    // A tie counts as a pan too — neither axis has claimed the gesture.
    expect(translate({ deltaX: 80, deltaY: 80 })).toBeNull();
  });

  it('normalizes line- and page-mode deltas before translating', () => {
    // Firefox reports deltaMode 1 (lines) and 2 (pages) instead of pixels.
    expect(translate({ deltaY: 3, deltaMode: 1 })).toBe(-120);
    expect(translate({ deltaY: 1, deltaMode: 2 })).toBe(-800);
  });

  it('is a no-op for a zero-delta tick', () => {
    expect(translate({ deltaY: 0, deltaX: 0 })).toBeNull();
  });
});
