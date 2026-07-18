import { describe, expect, it } from 'vitest';
import { blurRadiusFor, pixelSizeFor } from '../src/redact';

const box = { x: 0.25, y: 0.25, w: 0.25, h: 0.25 }; // 250×250 in a 1000×1000 frame
const W = 1000;
const H = 1000;

describe('blurRadiusFor', () => {
  it('grows with strength', () => {
    const low = blurRadiusFor(box, W, H, 0);
    const high = blurRadiusFor(box, W, H, 1);
    expect(high).toBeGreaterThan(low);
  });

  it('scales with the size of the region', () => {
    const small = { x: 0, y: 0, w: 0.05, h: 0.05 };
    const large = { x: 0, y: 0, w: 0.5, h: 0.5 };
    expect(blurRadiusFor(large, W, H, 0.5)).toBeGreaterThan(blurRadiusFor(small, W, H, 0.5));
  });

  it('never returns a radius too small to hide anything', () => {
    const tiny = { x: 0, y: 0, w: 0.001, h: 0.001 };
    expect(blurRadiusFor(tiny, W, H, 0)).toBeGreaterThanOrEqual(4);
  });

  it('clamps out-of-range strength instead of producing absurd radii', () => {
    expect(blurRadiusFor(box, W, H, -5)).toBe(blurRadiusFor(box, W, H, 0));
    expect(blurRadiusFor(box, W, H, 5)).toBe(blurRadiusFor(box, W, H, 1));
  });

  it('returns a finite integer', () => {
    const radius = blurRadiusFor(box, W, H, 0.75);
    expect(Number.isInteger(radius)).toBe(true);
    expect(Number.isFinite(radius)).toBe(true);
  });
});

describe('pixelSizeFor', () => {
  it('produces larger blocks — i.e. less detail — as strength rises', () => {
    const weak = pixelSizeFor(box, W, H, 0);
    const strong = pixelSizeFor(box, W, H, 1);
    expect(strong).toBeGreaterThan(weak);
  });

  it('keeps a minimum block size of 2px', () => {
    const tiny = { x: 0, y: 0, w: 0.002, h: 0.002 };
    expect(pixelSizeFor(tiny, W, H, 0)).toBeGreaterThanOrEqual(2);
  });

  it('leaves at most ~24 blocks across the region at the weakest setting', () => {
    const size = pixelSizeFor(box, W, H, 0);
    const blocksAcross = 250 / size;
    expect(blocksAcross).toBeLessThanOrEqual(25);
  });

  it('clamps out-of-range strength', () => {
    expect(pixelSizeFor(box, W, H, 2)).toBe(pixelSizeFor(box, W, H, 1));
    expect(pixelSizeFor(box, W, H, -1)).toBe(pixelSizeFor(box, W, H, 0));
  });

  it('returns a finite integer', () => {
    const size = pixelSizeFor(box, W, H, 0.5);
    expect(Number.isInteger(size)).toBe(true);
    expect(Number.isFinite(size)).toBe(true);
  });
});
