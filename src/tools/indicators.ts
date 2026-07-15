export function sma(values: number[], period: number): number {
  const slice = values.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / slice.length;
}

export function emaSeries(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const seed = sma(values.slice(0, period), period);
  const out: number[] = [seed];
  for (const value of values.slice(period)) {
    out.push(value * k + out[out.length - 1] * (1 - k));
  }
  return out;
}

export function ema(values: number[], period: number): number {
  const series = emaSeries(values, period);
  return series[series.length - 1];
}

// Wilder's RSI.
export function rsi(values: number[], period = 14): number {
  const changes = values.slice(1).map((v, i) => v - values[i]);
  let avgGain = changes.slice(0, period).filter((c) => c > 0).reduce((s, c) => s + c, 0) / period;
  let avgLoss = changes.slice(0, period).filter((c) => c < 0).reduce((s, c) => s - c, 0) / period;

  for (const change of changes.slice(period)) {
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): { macd: number; signal: number; histogram: number } {
  const fastSeries = emaSeries(values, fast);
  const slowSeries = emaSeries(values, slow);
  // Align series (fastSeries is longer since it starts earlier) to the tail shared by both.
  const offset = fastSeries.length - slowSeries.length;
  const macdSeries = slowSeries.map((slowVal, i) => fastSeries[i + offset] - slowVal);
  const signalSeries = emaSeries(macdSeries, signalPeriod);
  const macdValue = macdSeries[macdSeries.length - 1];
  const signalValue = signalSeries[signalSeries.length - 1];
  return { macd: macdValue, signal: signalValue, histogram: macdValue - signalValue };
}

export function bollingerBands(values: number[], period = 20, k = 2): { upper: number; middle: number; lower: number } {
  const slice = values.slice(-period);
  const middle = sma(slice, period);
  const variance = slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / slice.length;
  const stdDev = Math.sqrt(variance);
  return { upper: middle + k * stdDev, middle, lower: middle - k * stdDev };
}
