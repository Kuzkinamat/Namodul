// strategy-(autorun).js
// Unified strategy definition for the Autorun strategy.

window.StrategyDefinition = (function() {
    'use strict';

    function buildLogicEvaluator(source) {
        const logicBody = String(source || '').trim();
        if (!logicBody) {
            return function() {
                return { buy: 0, sell: 0 };
            };
        }

        const evaluator = new Function('ctx', `let buy = 0, sell = 0;\n${logicBody}\nreturn { buy, sell };`);
        return function(ctx) {
            const result = evaluator(ctx);
            if (!result || typeof result !== 'object') {
                return { buy: 0, sell: 0 };
            }

            return {
                buy: Number.isFinite(result.buy) ? result.buy : 0,
                sell: Number.isFinite(result.sell) ? result.sell : 0
            };
        };
    }

    const indicatorSettings = Object.freeze({
        useWorktime: true,
        
        useBB: true,
        bbPeriod: 20,
        bbStdDev: 2,

        useMACD: false,

        useATR: true,
        atrFastPeriod: 12,
        atrSlowPeriod: 120,
        
        useStochastic: true,
        stochasticK: 120,
        stochasticD: 12,
        stochasticSlowing: 3
    });

    const moneyManagementSettings = Object.freeze({
        expirationMinutes: 10,
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
// ctx.candle.current / ctx.candle.prev  — свечи
// ctx.indicators.bb.current             — текущий BB
// ctx.indicators.stochastic.prev        — предыдущий stochastic
// ctx.time.session                      — active session key
// ctx.trades.stats(n)                   — статистика сделок

const candle = ctx.candle.current;
const prevCandle = ctx.candle.prev;
const bb = ctx.indicators.bb.current;
const prevBB = ctx.indicators.bb.prev;
const stochastic = ctx.indicators.stochastic.current;
const prevStochastic = ctx.indicators.stochastic.prev;

function finite(value) {
    return Number.isFinite(value);
}

if (
    candle && prevCandle &&
    bb && prevBB && finite(bb.upper) && finite(bb.lower) && finite(prevBB.upper) && finite(prevBB.lower) &&
    stochastic && prevStochastic && finite(stochastic.k) && finite(stochastic.d) && finite(prevStochastic.k) && finite(prevStochastic.d)
) {
    const touchedLowerBand = candle.low <= bb.lower || prevCandle.low <= prevBB.lower;
    const touchedUpperBand = candle.high >= bb.upper || prevCandle.high >= prevBB.upper;

    const returnedAboveLowerBand = candle.close > bb.lower;
    const returnedBelowUpperBand = candle.close < bb.upper;

    const bullishCross = prevStochastic.k <= prevStochastic.d && stochastic.k > stochastic.d;
    const bearishCross = prevStochastic.k >= prevStochastic.d && stochastic.k < stochastic.d;

    const oversold = stochastic.k < 25 && stochastic.d < 30;
    const overbought = stochastic.k > 75 && stochastic.d > 70;

    if (touchedLowerBand && returnedAboveLowerBand && bullishCross && oversold) {
        buy = touchedUpperBand ? 1 : 1.2;
    }

    if (touchedUpperBand && returnedBelowUpperBand && bearishCross && overbought) {
        sell = touchedLowerBand ? 1 : 1.2;
    }
}
`;

    const evaluateLogic = buildLogicEvaluator(logicSource);

    const DEFAULT_PARAMS = Object.freeze({
        ...moneyManagementSettings,
        ...hoursSettings,
        ...indicatorSettings,
        rules: ''
    });

    function getDefaultParams() {
        return { ...DEFAULT_PARAMS };
    }

    function normalizeParams(params) {
        const merged = { ...DEFAULT_PARAMS, ...(params || {}) };

        if (!Number.isFinite(Number(merged.atrFastPeriod)) && Number.isFinite(Number(merged.atrPeriod))) {
            merged.atrFastPeriod = Number(merged.atrPeriod);
        }
        if (!Number.isFinite(Number(merged.atrSlowPeriod)) && Number.isFinite(Number(merged.atrSmoothPeriod))) {
            merged.atrSlowPeriod = Number(merged.atrSmoothPeriod);
        }

        merged.atrFastPeriod = Math.max(2, Number(merged.atrFastPeriod || DEFAULT_PARAMS.atrFastPeriod));
        merged.atrSlowPeriod = Math.max(2, Number(merged.atrSlowPeriod || DEFAULT_PARAMS.atrSlowPeriod));

        return merged;
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
        logic: Object.freeze({
            source: logicSource,
            evaluate: evaluateLogic
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

    function getDefaultParams() {
        return { ...defaultParams };
    }

    function normalizeParams(params) {
        return { ...defaultParams, ...(params || {}) };
    }

    return {
        DEFAULT_PARAMS: defaultParams,
        getDefaultParams,
        normalizeParams
    };
})(window.StrategyDefinition);
