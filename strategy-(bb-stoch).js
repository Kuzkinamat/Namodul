// strategy-(autorun).js
//m5

window.StrategyParams = (function() {
    'use strict';

    const DEFAULT_PARAMS = Object.freeze({
        baseStake:          1,
        filterTradingHours: true,
        expirationMinutes:  10,
        winPayout:          0.8,
        balFast:            40,
        balSlow:            160,

        useBB:              true,
        useStochastic:      true,

        useMartingale:      true,
        martingaleMultiplier: 5,
        martingaleMaxSteps: 3,

        rules: `
// c(lag)        — свеча:      .open .high .low .close
// bal(lag)      — баланс:     число или null
// balFast(lag)  — скорость баланса, % за период balFast
// balSlow(lag)  — скорость баланса, % за период balSlow
// balSpeed(lag, period) — скорость баланса, % за произвольный период
// dealStats(n)  — статистика последних n сделок
// lossCountWithinPeriods(n) — кол-во лоссов за последние n свечей

const cv0 = c(0), cv1 = c(-1), cv2 = c(-2), cv3 = c(-3), cv4 = c(-4), cv5 = c(-5);
const st0 = ind && typeof ind === 'function' ? ind('stochastic', 0) : null;

function isBull(v) { return v && v.close > v.open; }
function isBear(v) { return v && v.close < v.open; }

if (cv0 && cv1 && cv2 && cv3 && cv4 && cv5) {
        const stochOK = st0 && Number.isFinite(st0.k) && st0.k > 20 && st0.k < 80;
        // Поглощение на свече cv4 относительно cv5
        const bullishEngulfing =
            isBear(cv5) && isBull(cv4) &&
            cv4.open <= cv5.close && cv4.close >= cv5.open;

        const bearishEngulfing =
            isBull(cv5) && isBear(cv4) &&
            cv4.open >= cv5.close && cv4.close <= cv5.open;

        // 3 свечи продолжения сразу после поглощения
        const bullishSequence =
            isBull(cv3) && isBull(cv2) && isBull(cv1) &&
            cv3.close < cv2.close && cv2.close < cv1.close;

        const bearishSequence =
            isBear(cv3) && isBear(cv2) && isBear(cv1) &&
            cv3.close > cv2.close && cv2.close > cv1.close;

        // Коррекционная свеча (только цвет тела)
        const bullishCorrection = isBear(cv0);true
        const bearishCorrection = isBull(cv0);

        if (stochOK && bullishEngulfing && bullishSequence && bullishCorrection) {
            buy = 1;
        }

        if (stochOK && bearishEngulfing && bearishSequence && bearishCorrection) {
            sell = 1;
        }
}
`
    });

    function getDefaultParams() {
        return { ...DEFAULT_PARAMS };
    }

    function normalizeParams(params) {
        return { ...DEFAULT_PARAMS, ...(params || {}) };
    }

    return {
        DEFAULT_PARAMS,
        getDefaultParams,
        normalizeParams
    };
})();
