// strategy-core-signals.js
// Signal generation using user-defined rules evaluated per candle.

window.StrategyCoreSignals = (function() {
    'use strict';

    function createTimeIndexMap(data) {
        const timeIndexMap = new Map();
        for (let i = 0; i < data.length; i++) {
            timeIndexMap.set(data[i].time, i);
        }
        return timeIndexMap;
    }

    function findCloseIndex(data, entryIndex, closeTime) {
        for (let i = entryIndex; i < data.length; i++) {
            if (data[i].time >= closeTime) {
                return i;
            }
        }

        return data.length - 1;
    }

    function buildClosedTradeHistory(data, signals, currentIndex, expirationSeconds, timeIndexMap) {
        const history = [];
        const currentTime = data[currentIndex] ? data[currentIndex].time : null;
        if (!Number.isFinite(currentTime)) {
            return history;
        }

        for (const signal of signals) {
            const entryIndex = timeIndexMap.get(signal.time);
            if (entryIndex === undefined) {
                continue;
            }

            const closeTime = signal.time + expirationSeconds;
            const closeIndex = findCloseIndex(data, entryIndex, closeTime);
            const closeCandle = data[closeIndex];
            if (!closeCandle || closeCandle.time >= currentTime) {
                continue;
            }

            const entryPrice = signal.price;
            const closePrice = closeCandle.close;
            const isWin = signal.type === 'buy'
                ? closePrice > entryPrice
                : closePrice < entryPrice;

            history.push({
                time: signal.time,
                type: signal.type,
                closeTime: closeCandle.time,
                result: isWin ? 'win' : 'loss'
            });
        }

        return history;
    }

    function calculateSignals(data, params, indicators, tradeHistory) {
        const defaults = window.StrategyParams;
        const indicatorModule = window.StrategyCoreIndicators;
        const contextModule = window.StrategyCoreContext;
        if (!defaults || !indicatorModule || !contextModule) {
            return [];
        }

        const resolvedParams = defaults.normalizeParams(params);
        const resolvedIndicators = indicators || indicatorModule.calculateIndicators(data, resolvedParams, { silent: true, forceAll: true });
        if (!resolvedIndicators || !Array.isArray(data) || data.length < 2) {
            return [];
        }

        const signals = [];
        const expirationSeconds = (resolvedParams.expirationMinutes || 5) * 60;
        const timeIndexMap = createTimeIndexMap(data);

        // Инкрементальная история сделок: вместо пересчёта с нуля на каждой свече
        // обновляем только новые закрытые сделки
        const closedTradeHistory = [];
        let nextUncheckedSignal = 0;

        for (let i = 1; i < data.length; i++) {
            if (resolvedParams.filterTradingHours && data[i].isTradingHour === false) {
                continue;
            }

            // Инкрементально проверить, закрылись ли ранее открытые сигналы
            const currentTime = data[i].time;
            while (nextUncheckedSignal < signals.length) {
                const signal = signals[nextUncheckedSignal];
                const entryIndex = timeIndexMap.get(signal.time);
                if (entryIndex === undefined) {
                    nextUncheckedSignal++;
                    continue;
                }
                const closeTime = signal.time + expirationSeconds;
                const closeIndex = findCloseIndex(data, entryIndex, closeTime);
                const closeCandle = data[closeIndex];
                if (!closeCandle || closeCandle.time >= currentTime) {
                    break; // эта и все последующие сделки ещё не закрыты
                }
                const isWin = signal.type === 'buy'
                    ? closeCandle.close > signal.price
                    : closeCandle.close < signal.price;
                closedTradeHistory.push({
                    time: signal.time,
                    type: signal.type,
                    closeTime: closeCandle.time,
                    result: isWin ? 'win' : 'loss'
                });
                nextUncheckedSignal++;
            }

            const mergedTradeHistory = (tradeHistory || []).concat(closedTradeHistory);
            const context = contextModule.createConditionContext(i, data, resolvedIndicators, mergedTradeHistory);
            const { buy, sell } = contextModule.evaluateRules(resolvedParams.rules, context);

            if (buy >= 1) {
                signals.push({
                    time: data[i].time,
                    type: 'buy',
                    price: data[i].close,
                    buyStrength: buy,
                    sellStrength: 0
                });
            } else if (sell >= 1) {
                signals.push({
                    time: data[i].time,
                    type: 'sell',
                    price: data[i].close,
                    buyStrength: 0,
                    sellStrength: sell
                });
            }
        }

        return signals;
    }

    return {
        calculateSignals
    };
})();
