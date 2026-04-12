/**
 * ATR (Average True Range) Indicator
 * Measures price volatility
 */

function calcATR(candles, period = 60, smoothPeriod = 60) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return [];
  }

  const atr = [];
  const tr = []; // True Range

  // Calculate True Range for each candle
  for (let i = 0; i < candles.length; i++) {
    const current = candles[i];
    let trValue;

    if (i === 0) {
      // First candle: TR = High - Low
      trValue = current.high - current.low;
    } else {
      const prev = candles[i - 1];
      const h = current.high;
      const l = current.low;
      const pc = prev.close;

      // TR = max(H - L, |H - PC|, |L - PC|)
      const hl = h - l;
      const hc = Math.abs(h - pc);
      const lc = Math.abs(l - pc);
      trValue = Math.max(hl, hc, lc);
    }

    tr.push(trValue);

    // Calculate ATR as SMA of TR
    if (i < period - 1) {
      atr.push(null);
    } else if (i === period - 1) {
      // First ATR: simple average
      const sum = tr.slice(0, period).reduce((a, b) => a + b, 0);
      atr.push(sum / period);
    } else {
      // Smoothing: (PrevATR * (period - 1) + CurrentTR) / period
      const prevATR = atr[i - 1];
      const smoothedATR = (prevATR * (period - 1) + trValue) / period;
      atr.push(smoothedATR);
    }
  }

  const sp = Math.max(1, Number(smoothPeriod) || 1);
  if (sp <= 1) {
    return atr;
  }

  // Additional smoothing of ATR via EMA to reduce spikes on the chart.
  const k = 2 / (sp + 1);
  const smoothed = new Array(atr.length).fill(null);
  let prev = null;

  for (let i = 0; i < atr.length; i++) {
    const v = atr[i];
    if (!Number.isFinite(v)) {
      continue;
    }

    if (!Number.isFinite(prev)) {
      prev = v;
    } else {
      prev = (v - prev) * k + prev;
    }
    smoothed[i] = prev;
  }

  return smoothed;
}

/**
 * Export for use in strategy
 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { calcATR };
}
