// strategy-core-signals.js
// Signal generation using StrategyDefinition logic evaluated per candle.

window.StrategyCoreSignals = (function() {
    'use strict';

    function resolveStrategyLogicEvaluator() {
        const definition = window.StrategyDefinition;
        const logic = definition && definition.logic;
        return logic && typeof logic.evaluate === 'function' ? logic.evaluate : null;
    }

    function createRuntimeContext(context) {
        const current = typeof context.c === 'function' ? context.c(0) : null;
        const previous = typeof context.c === 'function' ? context.c(-1) : null;

        function createIndicatorAccessor(name) {
            return {
                current: typeof context.ind === 'function' ? context.ind(name, 0) : null,
                prev: typeof context.ind === 'function' ? context.ind(name, -1) : null,
                at: function(lag) {
                    return typeof context.ind === 'function' ? context.ind(name, Number(lag) || 0) : null;
                }
            };
        }

        return {
            candle: {
                current,
                prev: previous,
                at: function(lag) {
                    return typeof context.c === 'function' ? context.c(Number(lag) || 0) : null;
                }
            },
            time: current ? {
                isTrading: current.isTradingHour !== false,
                isWeekend: Boolean(current.isWeekend),
                dayOfWeek: Number.isFinite(current.dayOfWeek) ? current.dayOfWeek : null,
                hourUtc: Number.isFinite(current.hourUtc) ? current.hourUtc : null,
                minuteUtc: Number.isFinite(current.minuteUtc) ? current.minuteUtc : null,
                session: current.sessionKey || 'closed',
                sessionLabel: current.sessionLabel || 'Closed',
                tradingTimeSettings: current.tradingTimeSettings || null
            } : {
                isTrading: false,
                isWeekend: false,
                dayOfWeek: null,
                hourUtc: null,
                minuteUtc: null,
                session: 'closed',
                sessionLabel: 'Closed',
                tradingTimeSettings: null
            },
            indicators: {
                bb: createIndicatorAccessor('bb'),
                stochastic: createIndicatorAccessor('stochastic'),
                atr: createIndicatorAccessor('atr'),
                macd: createIndicatorAccessor('macd'),
                sma: createIndicatorAccessor('sma')
            },
            trades: {
                stats: typeof context.dealStats === 'function' ? context.dealStats : function() {
                    return { winCount: 0, lossCount: 0, totalProfit: 0, winRate: 0 };
                },
                lastLossWithinTf: typeof context.lastLossWithinTf === 'function' ? context.lastLossWithinTf : function() { return false; },
                lossCountWithinPeriods: typeof context.lossCountWithinPeriods === 'function' ? context.lossCountWithinPeriods : function() { return 0; }
            },
            legacy: {
                c: context.c,
                ind: context.ind,
                dealStats: context.dealStats,
                lastLossWithinTf: context.lastLossWithinTf,
                lossCountWithinPeriods: context.lossCountWithinPeriods
            }
        };
    }

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
        const evaluateLogic = resolveStrategyLogicEvaluator();
        if (!defaults || !indicatorModule || !contextModule || !evaluateLogic) {
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
            const sessionInfo = typeof contextModule.getSessionInfo === 'function'
                ? contextModule.getSessionInfo(data[i].time, resolvedParams)
                : null;

            if (resolvedParams.filterTradingHours && sessionInfo && sessionInfo.isTradingHour === false) {
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
            const context = contextModule.createConditionContext(i, data, resolvedIndicators, mergedTradeHistory, resolvedParams);
            const runtimeContext = createRuntimeContext(context);

            let result;
            try {
                result = evaluateLogic(runtimeContext);
            } catch (err) {
                contextModule.log('Ошибка в logic.evaluate: ' + err.message);
                return signals;
            }

            const buy = result && Number.isFinite(result.buy) ? result.buy : 0;
            const sell = result && Number.isFinite(result.sell) ? result.sell : 0;

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
