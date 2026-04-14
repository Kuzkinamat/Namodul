// strategy-(autorun).js
// Unified strategy definition using new naming system: c(), i.*, t()

window.StrategyDefinition = (function() {
    'use strict';

    function buildLogicEvaluator(source) {
        const logicBody = String(source || '').trim();
        if (!logicBody) {
            return function() {
                return { buy: 0, sell: 0 };
            };
        }

        // Compile once, reuse on every candle
        const fullCode = 'const c = arguments[0].c; const i = arguments[0].i; const t = arguments[0].t; const s = arguments[0].s || {}; let buy = 0, sell = 0; ' + logicBody + ' return { buy, sell };';
        const compiled = new Function(fullCode);

        return function(ctx) {
            if (!ctx) return { buy: 0, sell: 0 };
            try {
                const c = typeof ctx.c === 'function' ? ctx.c : null;
                const i = ctx.i || {};
                const t = typeof ctx.t === 'function' ? ctx.t : null;
                const s = ctx.s || {};
                if (!c || !i) return { buy: 0, sell: 0 };

                const result = compiled.call(null, { c, i, t, s });
                return {
                    buy: Number.isFinite(result.buy) ? result.buy : 0,
                    sell: Number.isFinite(result.sell) ? result.sell : 0
                };
            } catch (err) {
                console.error('Logic evaluation error:', err.message);
                return { buy: 0, sell: 0 };
            }
        };
    }

    const indicatorSettings = Object.freeze({
        useWorktime: true,
        
        useBB: true,
        bbPeriod: 20,
        bbStdDev: 2,

        useMACD: true,

        useSMA: true,
        smaPeriod: 200,

        useATR: false,
        atrFastPeriod: 14,
        atrSlowPeriod: 56,
        
        useStochastic: false,
        stochasticK: 14,
        stochasticD: 3,
        stochasticSlowing: 3
    });

    const moneyManagementSettings = Object.freeze({
        expirationMinutes: 15,
        winPayout: 0.8
    });

    const hoursSettings = Object.freeze({
        filterTradingHours: true,
        tradingOpenDayUtc: 1,
        tradingOpenHourUtc: 0,
        tradingOpenMinuteUtc: 0,
        tradingCloseDayUtc: 5,
        tradingCloseHourUtc: 22,
        tradingCloseMinuteUtc: 0,
        asiaSessionStartHourUtc: 0,
        europeSessionStartHourUtc: 7,
        usSessionStartHourUtc: 13
    });

    const logicSource = `
// Вход по сигналам из Signals:
// s.bb    = BB-флат (0|1)
// s.macd  = MACD-кроссовер (-1|0|+1)
// s.sma   = SMA200 тренд (-1..+1, > 0 = выше SMA, < 0 = ниже)
// s.value = результирующий (bb × macd)

// Вход только по тренду: покупаем выше SMA, продаём ниже
if (s.value >= 1  && s.sma > 0)  buy  = 1;
if (s.value <= -1 && s.sma < 0) sell = 1;
`;

    const evaluateLogic = buildLogicEvaluator(logicSource);

    function buildSignalsEvaluator(source) {
        const logicBody = String(source || '').trim();
        if (!logicBody) {
            return function() { return { bb: 0, macd: 0, value: 0, trend: 0 }; };
        }
        const fullCode = 'const c = arguments[0].c; const i = arguments[0].i; const t = arguments[0].t; let signal = 0, signal2 = 0, signal3 = 0, signal4 = 0; ' + logicBody + ' return { bb: signal, macd: signal2, value: signal3, sma: signal4 };';
        const compiled = new Function(fullCode);
        return function(ctx) {
            if (!ctx) return { bb: 0, macd: 0, value: 0, sma: 0 };
            try {
                const c = typeof ctx.c === 'function' ? ctx.c : null;
                const i = ctx.i || {};
                const t = typeof ctx.t === 'function' ? ctx.t : null;
                if (!c || !i) return { bb: 0, macd: 0, value: 0, sma: 0 };
                const result = compiled.call(null, { c, i, t });
                return {
                    bb:    Number.isFinite(result.bb)    ? result.bb    : 0,
                    macd:  Number.isFinite(result.macd)  ? result.macd  : 0,
                    value: Number.isFinite(result.value) ? result.value : 0,
                    sma:   Number.isFinite(result.sma)   ? result.sma   : 0
                };
            } catch (err) {
                console.error('Signals eval error:', err);
                return { bb: 0, macd: 0, value: 0, sma: 0 };
            }
        };
    }

    const signalsSource = `
// signal  → s.bb    (BB-флат: 0|1)
// signal2 → s.macd  (MACD-кроссовер: -1|0|+1)
// signal3 → s.value (результирующий = bb × macd)
// signal4 → s.trend (SMA200 тренд: +1 выше, -1 ниже)

// --- BB флат ---
const bb0 = i.bb(0);
let isFlat = false;
if (bb0 && bb0.m > 0) {
    const bwNorm = (bb0.u - bb0.l) / bb0.m;
    const WINDOW = 50;
    let maxBw = bwNorm;
    for (let lag = 1; lag < WINDOW; lag++) {
        const b = i.bb(-lag);
        if (b && b.m > 0) {
            const w = (b.u - b.l) / b.m;
            if (w > maxBw) maxBw = w;
        }
    }
    const relBw = maxBw > 0 ? bwNorm / maxBw : 1;
    isFlat = relBw > 0.3 && relBw <= 0.7;
}
signal = isFlat ? 1 : 0;

// --- MACD кроссовер ---
const mac0 = i.macd(0);
const mac1 = i.macd(-1);
if (mac0 && mac1 &&
    mac0.histogram !== null && mac0.histogram !== undefined &&
    mac1.histogram !== null && mac1.histogram !== undefined &&
    Math.sign(mac0.histogram) !== Math.sign(mac1.histogram) && mac1.histogram !== 0) {
    signal2 = mac0.histogram > 0 ? 1 : -1;
}

// --- SMA200 тренд (сырая разница close - SMA200) ---
const sma200 = i.sma(0);
const price = c(0);
if (sma200 !== null && sma200 !== undefined && price) {
    const smaValue = typeof sma200 === 'object' ? sma200.value : sma200;
    if (smaValue !== null && smaValue !== undefined) {
        signal4 = price.close - smaValue;
    }
}

// --- Результирующий ---
signal3 = signal * signal2;
`;

    const evaluateSignals = buildSignalsEvaluator(signalsSource);

    const DEFAULT_PARAMS = Object.freeze({
        ...moneyManagementSettings,
        ...hoursSettings,
        ...indicatorSettings
    });

    function getDefaultParams() {
        return { ...DEFAULT_PARAMS };
    }

    function normalizeParams(params) {
        return { ...DEFAULT_PARAMS, ...(params || {}) };
    }

    return {
        meta: Object.freeze({
            id: 'autorun',
            label: 'Autorun'
        }),
        settings: Object.freeze({
            indicators: indicatorSettings,
            moneyManagement: moneyManagementSettings,
            hours: hoursSettings
        }),
        entry: Object.freeze({
            source: logicSource,
            evaluate: evaluateLogic
        }),
        signals: Object.freeze({
            source: signalsSource,
            evaluate: evaluateSignals,
            color: 'rgba(38,166,154,0.9)',      // BB teal — верхняя граница флета
            colorNeg: 'rgba(38,166,154,0.9)'   // BB teal — нижняя граница флета
        }),
        DEFAULT_PARAMS,
        getDefaultParams,
        normalizeParams
    };
})();

window.StrategyParams = (function(definition) {
    'use strict';

    const defaultParams = definition && typeof definition.getDefaultParams === 'function'
        ? Object.freeze(definition.getDefaultParams())
        : Object.freeze({});

    return {
        getDefaultParams: function() {
            return { ...defaultParams };
        },
        normalizeParams: function(params) {
            return definition && typeof definition.normalizeParams === 'function'
                ? definition.normalizeParams(params)
                : { ...defaultParams, ...(params || {}) };
        }
    };
})(window.StrategyDefinition);
