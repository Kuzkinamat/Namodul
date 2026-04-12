// strategy-(autorun).js
//m5

window.StrategyParams = (function() {
    'use strict';

    const DEFAULT_PARAMS = Object.freeze({
        ...(window.StrategyAutorunMM || {}),
        ...(window.StrategyAutorunInd || {}),
        rules: typeof window.StrategyAutorunCode === 'string' ? window.StrategyAutorunCode : ''
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
