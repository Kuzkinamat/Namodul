// strategy-params.js
//m5

window.StrategyParams = (function() {
    'use strict';

    const DEFAULT_PARAMS = Object.freeze({
        baseStake:          1,
        filterTradingHours: true,
        expirationMinutes:  10,
        winPayout:          0.8,

        useSMA:             false,
        useBB:              true,
        useATR:             false,
        useMACD:            false,
        useStochastic:      true,

        sequenceCandles:    2,
        signalWindowCandles: 3,

        useMartingale:      true,
        martingaleMultiplier: 3,
        martingaleMaxSteps: 4,

        stopLossCnt:        3,
        stopLossPeriod:     10,

        rules: `
// c(lag)        — свеча:      .open .high .low .close
// bal(lag)      — баланс:     число или null
// dealStats(n)  — статистика последних n сделок
// lossCountWithinPeriods(n) — кол-во лоссов за последние n свечей

const params = (globalThis.Strategy && globalThis.Strategy.params) || {};

const seqCount = Math.max(3, Number(params.sequenceCandles ?? 3));
const signalWindowCandles = Math.max(seqCount + 1, Number(params.signalWindowCandles ?? 5));
const stopLossCnt = Math.max(0, Number(params.stopLossCnt ?? 4));
const stopLossPeriod = Math.max(1, Number(params.stopLossPeriod ?? 60));

const cv0 = c(0), cv1 = c(-1), cv2 = c(-2), cv3 = c(-3), cv4 = c(-4), cv5 = c(-5);
const st0 = ind && typeof ind === 'function' ? ind('stochastic', 0) : null;

function isBull(v) { return v && v.close > v.open; }
function isBear(v) { return v && v.close < v.open; }

if (cv0 && cv1 && cv2 && cv3 && cv4 && cv5) {
    const stopActive = stopLossCnt > 0 &&
        typeof lossCountWithinPeriods === 'function' &&
        lossCountWithinPeriods(stopLossPeriod) >= stopLossCnt;

    if (!stopActive) {
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

        // Все условия должны уложиться в первые 5 свечей после поглощения
        const withinWindow = signalWindowCandles >= (seqCount + 1);

        if (withinWindow && stochOK && bullishEngulfing && bullishSequence && bullishCorrection) {
            buy = 1;
        }

        if (withinWindow && stochOK && bearishEngulfing && bearishSequence && bearishCorrection) {
            sell = 1;
        }
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

