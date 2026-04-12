// strategy-(autorun)-code.js
// Signal rules for the Autorun strategy.

window.StrategyAutorunCode = `
// c(lag)        — свеча:      .open .high .low .close
// ind(name, lag) — индикатор: bb, stochastic, atr, macd, sma
// dealStats(n)  — статистика последних n сделок
// lossCountWithinPeriods(n) — кол-во лоссов за последние n свечей

const cv0 = c(0);
const cv1 = c(-1);
const bb0 = ind && typeof ind === 'function' ? ind('bb', 0) : null;
const bb1 = ind && typeof ind === 'function' ? ind('bb', -1) : null;
const st0 = ind && typeof ind === 'function' ? ind('stochastic', 0) : null;
const st1 = ind && typeof ind === 'function' ? ind('stochastic', -1) : null;

function finite(value) {
    return Number.isFinite(value);
}

if (
    cv0 && cv1 &&
    bb0 && bb1 && finite(bb0.upper) && finite(bb0.lower) && finite(bb1.upper) && finite(bb1.lower) &&
    st0 && st1 && finite(st0.k) && finite(st0.d) && finite(st1.k) && finite(st1.d)
) {
    const touchedLowerBand = cv0.low <= bb0.lower || cv1.low <= bb1.lower;
    const touchedUpperBand = cv0.high >= bb0.upper || cv1.high >= bb1.upper;

    const returnedAboveLowerBand = cv0.close > bb0.lower;
    const returnedBelowUpperBand = cv0.close < bb0.upper;

    const bullishCross = st1.k <= st1.d && st0.k > st0.d;
    const bearishCross = st1.k >= st1.d && st0.k < st0.d;

    const oversold = st0.k < 25 && st0.d < 30;
    const overbought = st0.k > 75 && st0.d > 70;

    if (touchedLowerBand && returnedAboveLowerBand && bullishCross && oversold) {
        buy = touchedUpperBand ? 1 : 1.2;
    }

    if (touchedUpperBand && returnedBelowUpperBand && bearishCross && overbought) {
        sell = touchedLowerBand ? 1 : 1.2;
    }
}
`;