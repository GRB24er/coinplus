import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPageNumbers,
  cn,
  convertOHLCData,
  ELLIPSIS,
  formatCurrency,
  formatPercentage,
  timeAgo,
  trendingClasses,
} from '@/lib/utils';

describe('cn', () => {
  it('merges conditional classes and drops falsy values', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c');
  });

  it('lets later tailwind utilities win conflicts', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
});

describe('formatCurrency', () => {
  it('falls back to a symbol string for nullish / NaN input', () => {
    expect(formatCurrency(null)).toBe('$0.00');
    expect(formatCurrency(undefined)).toBe('$0.00');
    expect(formatCurrency(NaN)).toBe('$0.00');
  });

  it('falls back without a symbol when showSymbol is false', () => {
    expect(formatCurrency(null, undefined, undefined, false)).toBe('0.00');
  });

  it('formats a value with the USD symbol by default', () => {
    expect(formatCurrency(5)).toBe('$5.00');
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
  });

  it('honours digits and the no-symbol flag', () => {
    expect(formatCurrency(5, 2, undefined, false)).toBe('5.00');
    expect(formatCurrency(5, 0, undefined, false)).toBe('5');
  });
});

describe('formatPercentage', () => {
  it('rounds to a single decimal place', () => {
    expect(formatPercentage(12.345)).toBe('12.3%');
    expect(formatPercentage(-3.14)).toBe('-3.1%');
  });

  it('returns a zero string for nullish / NaN input', () => {
    expect(formatPercentage(null)).toBe('0.0%');
    expect(formatPercentage(undefined)).toBe('0.0%');
    expect(formatPercentage(NaN)).toBe('0.0%');
  });
});

describe('trendingClasses', () => {
  it('returns up styling for positive values', () => {
    expect(trendingClasses(5)).toEqual({
      textClass: 'text-green-400',
      bgClass: 'bg-green-500/10',
      iconClass: 'icon-up',
    });
  });

  it('treats zero and negatives as down', () => {
    expect(trendingClasses(0).iconClass).toBe('icon-down');
    expect(trendingClasses(-1).textClass).toBe('text-red-400');
  });
});

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('describes recent and older timestamps relative to now', () => {
    const now = Date.now();
    expect(timeAgo(now)).toBe('just now');
    expect(timeAgo(now - 5 * 60_000)).toBe('5 min');
    expect(timeAgo(now - 60 * 60_000)).toBe('1 hour');
    expect(timeAgo(now - 3 * 60 * 60_000)).toBe('3 hours');
    expect(timeAgo(now - 2 * 24 * 60 * 60_000)).toBe('2 days');
  });

  it('falls back to an ISO date for anything older than a month', () => {
    expect(timeAgo(new Date('2025-09-15T12:00:00Z'))).toBe('2025-09-15');
  });
});

describe('convertOHLCData', () => {
  it('maps tuples into the chart series shape', () => {
    expect(convertOHLCData([[1, 2, 3, 4, 5]])).toEqual([
      { time: 1, open: 2, high: 3, low: 4, close: 5 },
    ]);
  });

  it('drops consecutive candles that share a timestamp', () => {
    const result = convertOHLCData([
      [1, 2, 3, 4, 5],
      [1, 9, 9, 9, 9],
      [2, 6, 7, 8, 9],
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((candle) => candle.time)).toEqual([1, 2]);
  });
});

describe('buildPageNumbers', () => {
  it('lists every page when the total fits the window', () => {
    expect(buildPageNumbers(1, 3)).toEqual([1, 2, 3]);
    expect(buildPageNumbers(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('inserts ellipses around the current page for large ranges', () => {
    expect(buildPageNumbers(5, 20)).toEqual([1, ELLIPSIS, 4, 5, 6, ELLIPSIS, 20]);
  });

  it('omits the leading ellipsis near the start', () => {
    expect(buildPageNumbers(1, 20)).toEqual([1, 2, ELLIPSIS, 20]);
  });

  it('omits the trailing ellipsis near the end', () => {
    expect(buildPageNumbers(20, 20)).toEqual([1, ELLIPSIS, 19, 20]);
  });
});
