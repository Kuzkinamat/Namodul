// strategy-core-indicators.js
// Indicator calculations used by StrategyCore.

window.StrategyCoreIndicators = (function() {
    'use strict';

    function calculateIndicators(data, params, options) {
        const defaults = window.StrategyParams;
        const context = window.StrategyCoreContext;
        if (!defaults || !context) {
            return null;
        }

        const resolvedParams = defaults.normalizeParams(params);
        const indicators = {
            macd: [],
            stochastic: [],
            sma: [],
            bb: [],
            atr: []
        };

        if (!Array.isArray(data) || data.length === 0) {
            return indicators;
        }

        const requestedOnly = options && Array.isArray(options.only) ? options.only : null;
        const shouldCalcSMA = (options && options.forceAll) ||
            (requestedOnly ? requestedOnly.includes('sma') : resolvedParams.useSMA === true);
        const shouldCalcBB = (options && options.forceAll) ||
            (requestedOnly ? requestedOnly.includes('bb') : resolvedParams.useBB !== false);
        const shouldCalcMACD = (options && options.forceAll) ||
            (requestedOnly ? requestedOnly.includes('macd') : resolvedParams.useMACD === true);
        const shouldCalcStochastic = (options && options.forceAll) ||
            (requestedOnly ? requestedOnly.includes('stochastic') : resolvedParams.useStochastic === true);
        const shouldCalcATR = (options && options.forceAll) ||
            (requestedOnly ? requestedOnly.includes('atr') : resolvedParams.useATR === true);

        if (shouldCalcSMA) {
            if (typeof window.calcSMA !== 'function') {
                if (!(options && options.silent)) {
                    context.log('Ошибка: функция calcSMA не найдена');
                }
                return null;
            }

            const smaPeriod = Math.max(2, Number(resolvedParams.smaPeriod || 20));
            const sma = window.calcSMA(data, smaPeriod);
            if (!Array.isArray(sma) || sma.length !== data.length) {
                if (!(options && options.silent)) {
                    const len = Array.isArray(sma) ? sma.length : 0;
                    context.log(`Ошибка: длина SMA (${len}) не совпадает с данными (${data.length})`);
                }
                return null;
            }
            indicators.sma = sma;
        }

        if (shouldCalcBB) {
            if (typeof window.calcBB !== 'function') {
                if (!(options && options.silent)) {
                    context.log('Ошибка: функция calcBB не найдена');
                }
                return null;
            }

            const bb = window.calcBB(data, resolvedParams.bbPeriod, resolvedParams.bbStdDev);
            if (!Array.isArray(bb) || bb.length !== data.length) {
                if (!(options && options.silent)) {
                    const len = Array.isArray(bb) ? bb.length : 0;
                    context.log(`Ошибка: длина Bollinger Bands (${len}) не совпадает с данными (${data.length})`);
                }
                return null;
            }
            indicators.bb = bb;
        }

        if (shouldCalcMACD) {
            if (typeof window.calcMACD !== 'function') {
                if (!(options && options.silent)) {
                    context.log('Ошибка: функция calcMACD не найдена');
                }
                return null;
            }

            if (!(options && options.silent)) {
                context.log('Расчет MACD...');
            }

            const macd = window.calcMACD(data, resolvedParams.macdFast || 12, resolvedParams.macdSlow || 26, resolvedParams.macdSignal || 9);
            if (!Array.isArray(macd) || macd.length !== data.length) {
                if (!(options && options.silent)) {
                    const len = Array.isArray(macd) ? macd.length : 0;
                    context.log(`Ошибка: длина MACD (${len}) не совпадает с данными (${data.length})`);
                }
                return null;
            }
            indicators.macd = macd;
        }

        if (shouldCalcStochastic) {
            if (typeof window.calcStochastic !== 'function') {
                if (!(options && options.silent)) {
                    context.log('Ошибка: функция calcStochastic не найдена');
                }
                return null;
            }

            const stochastic = window.calcStochastic(
                data,
                Math.max(2, Number(resolvedParams.stochasticK || 14)),
                Math.max(1, Number(resolvedParams.stochasticD || 3)),
                Math.max(1, Number(resolvedParams.stochasticSlowing || 3))
            );
            if (!Array.isArray(stochastic) || stochastic.length !== data.length) {
                if (!(options && options.silent)) {
                    const len = Array.isArray(stochastic) ? stochastic.length : 0;
                    context.log(`Ошибка: длина Stochastic (${len}) не совпадает с данными (${data.length})`);
                }
                return null;
            }
            indicators.stochastic = stochastic;
        }

        if (shouldCalcATR) {
            if (typeof window.calcATR !== 'function') {
                if (!(options && options.silent)) {
                    context.log('Ошибка: функция calcATR не найдена');
                }
                return null;
            }

            const atrFast = window.calcATR(
                data,
                Math.max(2, Number(resolvedParams.atrFastPeriod || resolvedParams.atrPeriod || 14)),
                1
            );
            const atrSlow = window.calcATR(
                data,
                Math.max(2, Number(resolvedParams.atrSlowPeriod || resolvedParams.atrSmoothPeriod || 28)),
                1
            );
            if (!Array.isArray(atrFast) || atrFast.length !== data.length || !Array.isArray(atrSlow) || atrSlow.length !== data.length) {
                if (!(options && options.silent)) {
                    const fastLen = Array.isArray(atrFast) ? atrFast.length : 0;
                    const slowLen = Array.isArray(atrSlow) ? atrSlow.length : 0;
                    context.log(`Ошибка: длина ATR fast/slow (${fastLen}/${slowLen}) не совпадает с данными (${data.length})`);
                }
                return null;
            }
            indicators.atr = data.map(function(_, index) {
                return {
                    fast: atrFast[index],
                    slow: atrSlow[index]
                };
            });
        }

        return indicators;
    }

    return {
        calculateIndicators
    };
})();
