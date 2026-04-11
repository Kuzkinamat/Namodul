// strategy-core.js
// Tiny facade with stable API for loading/swapping strategy files.

window.StrategyCore = (function() {
    'use strict';

    // StrategyParams загружается динамически через strategy-editor.js,
    // поэтому его отсутствие на раннем этапе — штатная ситуация.
    const DEFERRED_MODULES = new Set(['StrategyParams']);

    function getModule(name) {
        const moduleRef = window[name];
        if (!moduleRef && !DEFERRED_MODULES.has(name) && typeof window.addLog === 'function') {
            window.addLog(`Ошибка: не загружен модуль ${name}`);
        }
        return moduleRef;
    }

    function call(name, method, fallback, args) {
        const moduleRef = getModule(name);
        if (!moduleRef || typeof moduleRef[method] !== 'function') {
            return fallback;
        }
        return moduleRef[method](...(args || []));
    }

    return {
        getDefaultParams: function() {
            return call('StrategyParams', 'getDefaultParams', {}, []);
        },
        normalizeParams: function(params) {
            return call('StrategyParams', 'normalizeParams', { ...(params || {}) }, [params]);
        },
        calculateIndicators: function(data, params, options) {
            return call('StrategyCoreIndicators', 'calculateIndicators', null, [data, params, options]);
        },
        createConditionContext: function(index, candles, indicators, history) {
            return call('StrategyCoreContext', 'createConditionContext', null, [index, candles, indicators, history]);
        },
        evaluateCondition: function(conditionText, context) {
            return call('StrategyCoreContext', 'evaluateCondition', false, [conditionText, context]);
        },
        evaluateRules: function(rulesCode, context) {
            return call('StrategyCoreContext', 'evaluateRules', { buy: 0, sell: 0 }, [rulesCode, context]);
        },
        calculateSignals: function(candles, params, indicators, history) {
            return call('StrategyCoreSignals', 'calculateSignals', [], [candles, params, indicators, history]);
        },
        isTradingHour: function(timestamp) {
            return call('StrategyCoreContext', 'isTradingHour', false, [timestamp]);
        },
        enrichDataWithTradingHours: function(candles) {
            return call('StrategyCoreContext', 'enrichDataWithTradingHours', candles, [candles]);
        }
    };
})();