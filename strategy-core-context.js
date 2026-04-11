// strategy-core-context.js
// Logging, trading-hour checks, condition context and condition evaluation.

window.StrategyCoreContext = (function() {
    'use strict';

    function log(message) {
        if (typeof window.addLog === 'function') {
            window.addLog(message);
        }
    }

    function isTradingHour(timestamp) {
        if (!timestamp) return false;

        const ts = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
        const date = new Date(ts * 1000);
        const dayOfWeek = date.getUTCDay();
        const hours = date.getUTCHours();

        if (dayOfWeek >= 1 && dayOfWeek <= 4) return true;
        if (dayOfWeek === 5 && hours < 21) return true;
        if (dayOfWeek === 1 && hours >= 21) return true;

        return false;
    }

    function enrichDataWithTradingHours(data) {
        if (!Array.isArray(data)) {
            return data;
        }

        return data.map(candle => ({
            ...candle,
            isTradingHour: isTradingHour(candle.time)
        }));
    }

    function createConditionContext(i, data, indicators, tradeHistory) {
        function c(lag) {
            const idx = i + lag;
            if (idx < 0 || idx >= data.length) return null;
            return data[idx];
        }

        function ind(name, lag) {
            const idx = i + lag;
            if (idx < 0) {
                return name === 'bb' ? { upper: null, middle: null, lower: null } : null;
            }

            const series = indicators[name];
            if (!series) {
                return name === 'bb' ? { upper: null, middle: null, lower: null } : null;
            }

            const value = series[idx];
            if (value) {
                return value;
            }

            return name === 'bb' ? { upper: null, middle: null, lower: null } : null;
        }

        function bal(lag) {
            const arr = window.lastBalance;
            if (!arr) return null;
            const idx = i + lag;
            if (idx < 0 || idx >= arr.length) return null;
            return arr[idx] ? arr[idx].value : null;
        }

        function readBalanceSpeed(lag, period) {
            const arr = window.lastBalance;
            if (!arr) return null;

            const normalizedPeriod = Math.max(1, Number(period) || 1);
            const idx = i + lag;
            const prevIdx = idx - normalizedPeriod;
            if (idx < 0 || idx >= arr.length || prevIdx < 0 || prevIdx >= arr.length) {
                return null;
            }

            const currentValue = Number(arr[idx] && arr[idx].value);
            const previousValue = Number(arr[prevIdx] && arr[prevIdx].value);
            if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue) || previousValue === 0) {
                return null;
            }

            return ((currentValue - previousValue) / previousValue) * 100;
        }

        function balSpeed(lag, period) {
            return readBalanceSpeed(Number(lag) || 0, period);
        }

        function balFast(lag) {
            const period = Math.max(1, Number(window.Strategy?.params?.balFast ?? 40));
            return readBalanceSpeed(Number(lag) || 0, period);
        }

        function balSlow(lag) {
            const period = Math.max(1, Number(window.Strategy?.params?.balSlow ?? 160));
            return readBalanceSpeed(Number(lag) || 0, period);
        }

        function lastLossWithinTf(tfCount = 2) {
            const history = tradeHistory || [];
            if (!history.length) return false;

            const lastTrade = history[history.length - 1];
            if (!lastTrade || lastTrade.result !== 'loss') return false;

            const currentCandle = data[i];
            if (!currentCandle || !Number.isFinite(currentCandle.time) || !Number.isFinite(lastTrade.closeTime)) {
                return false;
            }

            const expirationMinutes = Number(
                (window.Strategy && window.Strategy.params && window.Strategy.params.expirationMinutes) || 5
            );
            const windowSeconds = Math.max(1, expirationMinutes) * 60 * Math.max(1, Number(tfCount) || 1);
            const dt = currentCandle.time - lastTrade.closeTime;

            return dt > 0 && dt <= windowSeconds;
        }

        function lossCountWithinPeriods(periods = 60) {
            const history = tradeHistory || [];
            const currentCandle = data[i];
            if (!history.length || !currentCandle || !Number.isFinite(currentCandle.time)) {
                return 0;
            }

            const windowPeriods = Math.max(1, Number(periods) || 1);
            const fromIndex = Math.max(0, i - windowPeriods + 1);
            const fromTime = data[fromIndex] && Number.isFinite(data[fromIndex].time)
                ? data[fromIndex].time
                : currentCandle.time;
            let count = 0;

            for (let idx = history.length - 1; idx >= 0; idx--) {
                const trade = history[idx];
                if (!trade || trade.result !== 'loss' || !Number.isFinite(trade.closeTime)) {
                    continue;
                }

                if (trade.closeTime >= currentCandle.time) {
                    continue;
                }
                if (trade.closeTime < fromTime) {
                    break;
                }
                count += 1;
            }

            return count;
        }

        return {
            i,
            data,
            indicators,
            tradeHistory: tradeHistory || [],
            c,
            ind,
            bal,
            balSpeed,
            balFast,
            balSlow,
            lastLossWithinTf,
            lossCountWithinPeriods,

            indicator: function(name, lag = 0) {
                const idx = i - lag;
                if (idx < 0) return null;
                const series = indicators[name];
                if (!series || !series[idx]) return null;
                return series[idx];
            },

            price: function(type = 'close', lag = 0) {
                const idx = i - lag;
                if (idx < 0 || !data[idx]) return null;
                return data[idx][type];
            },

            dealStats: function(windowSize) {
                const history = tradeHistory || [];
                if (!history.length) {
                    return { winCount: 0, lossCount: 0, totalProfit: 0, winRate: 0 };
                }
                const recent = history.slice(-windowSize);
                const winCount = recent.filter(d => d.result === 'win').length;
                const lossCount = recent.filter(d => d.result === 'loss').length;
                const totalProfit = recent.reduce((sum, d) => sum + (d.profit || 0), 0);
                const winRate = recent.length ? winCount / recent.length : 0;
                return { winCount, lossCount, totalProfit, winRate };
            }
        };
    }

    function evaluateCondition(condition, context) {
        if (!condition || condition.trim() === '') {
            return true;
        }

        try {
            const fn = new Function(...Object.keys(context), `return ${condition};`);
            return Boolean(fn(...Object.values(context)));
        } catch (err) {
            log('Ошибка выполнения условия: ' + err.message);
            return false;
        }
    }

    function evaluateRules(rulesCode, context) {
        if (!rulesCode || rulesCode.trim() === '') {
            return { buy: 0, sell: 0 };
        }
        try {
            const safeDealStats = typeof context.dealStats === 'function'
                ? context.dealStats
                : function() {
                    return { winCount: 0, lossCount: 0, totalProfit: 0, winRate: 0 };
                };
            const safeLastLossWithinTf = typeof context.lastLossWithinTf === 'function'
                ? context.lastLossWithinTf
                : function() { return false; };
            const safeLossCountWithinPeriods = typeof context.lossCountWithinPeriods === 'function'
                ? context.lossCountWithinPeriods
                : function() { return 0; };

            const fn = new Function('c', 'ind', 'bal', 'dealStats', 'lastLossWithinTf', 'lossCountWithinPeriods',
                `let buy = 0, sell = 0;\n${rulesCode}\nreturn { buy, sell };`
            );
            const result = fn(context.c, context.ind, context.bal, safeDealStats, safeLastLossWithinTf, safeLossCountWithinPeriods);
            if (!result || typeof result !== 'object') {
                return { buy: 0, sell: 0 };
            }
            return {
                buy: Number.isFinite(result.buy) ? result.buy : 0,
                sell: Number.isFinite(result.sell) ? result.sell : 0
            };
        } catch (err) {
            log('Ошибка в rules: ' + err.message);
            return { buy: 0, sell: 0 };
        }
    }

    return {
        log,
        isTradingHour,
        enrichDataWithTradingHours,
        createConditionContext,
        evaluateCondition,
        evaluateRules
    };
})();
