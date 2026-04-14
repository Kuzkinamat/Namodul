// strategy-core-signals.js
// Signal generation using StrategyDefinition logic evaluated per candle.

window.StrategyCoreSignals = (function() {
    'use strict';

    function resolveStrategyLogicEvaluator() {
        const definition = window.StrategyDefinition;
        const entry = (definition && definition.entry) || (definition && definition.logic);
        return entry && typeof entry.evaluate === 'function' ? entry.evaluate : null;
    }

    function resolveStrategySignalsEvaluator() {
        const definition = window.StrategyDefinition;
        return definition && definition.signals && typeof definition.signals.evaluate === 'function'
            ? definition.signals.evaluate
            : null;
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

        // Ensure context.i exists and has indicator functions
        let indicatorNamespace = context.i;
        if (!indicatorNamespace) {
            console.warn('context.i is missing, creating empty namespace');
            indicatorNamespace = {};
        }

        return {
            // New naming system: c(), i.*, t()
            c: typeof context.c === 'function' ? context.c : null,
            i: indicatorNamespace,
            t: typeof context.t === 'function' ? context.t : null,
            
            // Legacy structures for backward compatibility
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

    function createTradeObject(signalType, entryTime, closeTime, entryIndex, closeIndex, data, stake) {
        const trade = {
            // Новые поля согласно диктионарю
            t: stake || 0,                           // take (размер позиции)
            dir: signalType,                         // direction: 'buy' или 'sell'
            start: entryTime,                        // unix time открытия
            end: closeTime,                          // unix time закрытия
            win: null,                               // result: 'win' или 'loss' (вычислим ниже)
            
            // Старые поля для обратной совместимости
            time: entryTime,
            type: signalType,
            closeTime: closeTime,
            result: null,
            stake: stake || 0,
            
            // Методы доступа к свечам
            openCandle: function() {
                if (entryIndex >= 0 && entryIndex < data.length) {
                    return data[entryIndex];
                }
                return null;
            },
            closeCandle: function() {
                if (closeIndex >= 0 && closeIndex < data.length) {
                    return data[closeIndex];
                }
                return null;
            }
        };
        
        return trade;
    }

    function calculateSignals(data, params, indicators, tradeHistory) {
        // Normalize data format: rename open/high/low/close/volume to o/h/l/c/v for new naming system
        const normalizedData = (data || []).map(candle => {
            if (!candle) return candle;
            // Keep both old and new names for compatibility
            return {
                time: candle.time,
                // New short names (as per dictionary)
                o: 'open' in candle ? candle.open : candle.o,
                h: 'high' in candle ? candle.high : candle.h,
                l: 'low' in candle ? candle.low : candle.l,
                c: 'close' in candle ? candle.close : candle.c,
                v: 'volume' in candle ? candle.volume : candle.v,
                t: candle.time,  // t = time (alias)
                // Keep old names for backward compatibility
                open: 'open' in candle ? candle.open : candle.o,
                high: 'high' in candle ? candle.high : candle.h,
                low: 'low' in candle ? candle.low : candle.l,
                close: 'close' in candle ? candle.close : candle.c,
                volume: 'volume' in candle ? candle.volume : candle.v
            };
        });

        const defaults = window.StrategyParams;
        const indicatorModule = window.StrategyCoreIndicators;
        const contextModule = window.StrategyCoreContext;
        const evaluateLogic = resolveStrategyLogicEvaluator();
        const evaluateSignalsForEntry = resolveStrategySignalsEvaluator();
        if (!defaults || !indicatorModule || !contextModule || !evaluateLogic) {
            contextModule.log('Debug: missing required modules');
            return [];
        }

        const resolvedParams = defaults.normalizeParams(params);
        const resolvedIndicators = indicators || indicatorModule.calculateIndicators(normalizedData, resolvedParams, { silent: true, forceAll: true });
        if (!resolvedIndicators || !Array.isArray(normalizedData) || normalizedData.length < 2) {
            contextModule.log('Debug: invalid data or indicators');
            return [];
        }

        contextModule.log(`Calculating signals for ${normalizedData.length} candles...`);

        const signals = [];
        const expirationSeconds = (resolvedParams.expirationMinutes || 5) * 60;
        const timeIndexMap = createTimeIndexMap(normalizedData);

        // Инкрементальная история сделок: вместо пересчёта с нуля на каждой свече
        // обновляем только новые закрытые сделки
        const closedTradeHistory = [];
        let nextUncheckedSignal = 0;
        const startTime = Date.now();

        for (let i = 1; i < normalizedData.length; i++) {
            // Safety check for timeout (max 30 seconds)
            if (Date.now() - startTime > 30000) {
                contextModule.log(`Timeout: signal calculation stopped at candle ${i}/${normalizedData.length}`);
                break;
            }

            const sessionInfo = typeof contextModule.getSessionInfo === 'function'
                ? contextModule.getSessionInfo(normalizedData[i].time, resolvedParams)
                : null;

            if (resolvedParams.filterTradingHours && sessionInfo && sessionInfo.isTradingHour === false) {
                continue;
            }

            // Инкрементально проверить, закрылись ли ранее открытые сигналы
            const currentTime = normalizedData[i].time;
            while (nextUncheckedSignal < signals.length) {
                const signal = signals[nextUncheckedSignal];
                const entryIndex = timeIndexMap.get(signal.time);
                if (entryIndex === undefined) {
                    nextUncheckedSignal++;
                    continue;
                }
                const closeTime = signal.time + expirationSeconds;
                const closeIndex = findCloseIndex(normalizedData, entryIndex, closeTime);
                const closeCandle = normalizedData[closeIndex];
                if (!closeCandle || closeCandle.time >= currentTime) {
                    break; // эта и все последующие сделки ещё не закрыты
                }
                const isWin = signal.type === 'buy'
                    ? closeCandle.c > signal.price
                    : closeCandle.c < signal.price;
                
                const trade = createTradeObject(signal.type, signal.time, closeCandle.time, entryIndex, closeIndex, normalizedData, signal.stake || 0);
                trade.win = isWin ? 'win' : 'loss';
                trade.result = trade.win; // для совместимости
                
                closedTradeHistory.push(trade);
                nextUncheckedSignal++;
            }

            const mergedTradeHistory = (tradeHistory || []).concat(closedTradeHistory);
            const context = contextModule.createConditionContext(i, normalizedData, resolvedIndicators, mergedTradeHistory, resolvedParams);
            const runtimeContext = createRuntimeContext(context);

            // Вычислить сигналы (Signals) и передать в Code как ctx.s
            if (evaluateSignalsForEntry) {
                try {
                    const sv = evaluateSignalsForEntry(runtimeContext);
                    runtimeContext.s = {
                        bb:    sv && Number.isFinite(sv.bb)    ? sv.bb    : 0,
                        macd:  sv && Number.isFinite(sv.macd)  ? sv.macd  : 0,
                        value: sv && Number.isFinite(sv.value) ? sv.value : 0,
                        sma: sv && Number.isFinite(sv.sma) ? sv.sma : 0
                    };
                } catch (e) {
                    runtimeContext.s = { bb: 0, macd: 0, value: 0, sma: 0 };
                }
            } else {
                runtimeContext.s = { bb: 0, macd: 0, value: 0, sma: 0 };
            }

            let result;
            try {
                result = evaluateLogic(runtimeContext);
            } catch (err) {
                contextModule.log(`Error at candle ${i}: ${err.message}`);
                continue;
            }

            if (!result || typeof result !== 'object') {
                contextModule.log(`Invalid result at candle ${i}: ${JSON.stringify(result)}`);
                continue;
            }

            const buy = result && Number.isFinite(result.buy) ? result.buy : 0;
            const sell = result && Number.isFinite(result.sell) ? result.sell : 0;

            // Вход — с открытием следующей свечи (i+1)
            const entryCandle = normalizedData[i + 1];
            if (!entryCandle) continue;

            if (buy >= 1) {
                signals.push({
                    time: entryCandle.time,
                    type: 'buy',
                    price: entryCandle.o,
                    buyStrength: buy,
                    sellStrength: 0
                });
            } else if (sell >= 1) {
                signals.push({
                    time: entryCandle.time,
                    type: 'sell',
                    price: entryCandle.o,
                    buyStrength: 0,
                    sellStrength: sell
                });
            }

        }

        contextModule.log(`Signal calculation complete: ${signals.length} signals in ${Date.now() - startTime}ms`);
        return signals;
    }

    function calculateSignalPaneData(data, params, indicators) {
        const definition = window.StrategyDefinition;
        const evaluateSignals = definition && definition.signals && typeof definition.signals.evaluate === 'function'
            ? definition.signals.evaluate
            : null;
        if (!evaluateSignals) {
            return [];
        }

        const defaults = window.StrategyParams;
        const indicatorModule = window.StrategyCoreIndicators;
        const contextModule = window.StrategyCoreContext;
        if (!defaults || !indicatorModule || !contextModule) {
            return [];
        }

        const normalizedData = (data || []).map(candle => {
            if (!candle) return candle;
            return {
                time: candle.time,
                o: 'open' in candle ? candle.open : candle.o,
                h: 'high' in candle ? candle.high : candle.h,
                l: 'low' in candle ? candle.low : candle.l,
                c: 'close' in candle ? candle.close : candle.c,
                v: 'volume' in candle ? candle.volume : candle.v,
                t: candle.time,
                open: 'open' in candle ? candle.open : candle.o,
                high: 'high' in candle ? candle.high : candle.h,
                low: 'low' in candle ? candle.low : candle.l,
                close: 'close' in candle ? candle.close : candle.c,
                volume: 'volume' in candle ? candle.volume : candle.v
            };
        });

        const resolvedParams = defaults.normalizeParams(params);
        const resolvedIndicators = indicators || indicatorModule.calculateIndicators(normalizedData, resolvedParams, { silent: true, forceAll: true });
        if (!resolvedIndicators || !normalizedData.length) {
            return [];
        }

        const result = [];
        for (let i = 1; i < normalizedData.length; i++) {
            const context = contextModule.createConditionContext(i, normalizedData, resolvedIndicators, [], resolvedParams);
            const runtimeContext = createRuntimeContext(context);
            let val = 0, val2 = 0, val3 = 0, val4 = 0;
            try {
                const r = evaluateSignals(runtimeContext);
                val  = r && Number.isFinite(r.bb)    ? r.bb    : 0;
                val2 = r && Number.isFinite(r.macd)  ? r.macd  : 0;
                val3 = r && Number.isFinite(r.value) ? r.value : 0;
                val4 = r && Number.isFinite(r.sma) ? r.sma : 0;
            } catch (err) {
                // skip
            }
            result.push({ time: normalizedData[i].time, value: val, value2: val2, composite: val3, sma: val4 });
        }

        // Normalize sma values to (-1, 1] using rolling max over 200 bars
        const NORM_WINDOW = 200;
        for (let i = 0; i < result.length; i++) {
            const raw = result[i].sma;
            if (raw === 0) continue;
            let maxAbs = Math.abs(raw);
            for (let j = Math.max(0, i - NORM_WINDOW + 1); j < i; j++) {
                const a = Math.abs(result[j].sma);
                if (a > maxAbs) maxAbs = a;
            }
            result[i].sma = maxAbs > 0 ? raw / maxAbs : 0;
        }

        return result;
    }

    return {
        calculateSignals,
        calculateSignalPaneData
    };
})();
