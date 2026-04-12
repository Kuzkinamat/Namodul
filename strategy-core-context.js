// strategy-core-context.js
// Logging, trading-hour checks, condition context and condition evaluation.

window.StrategyCoreContext = (function() {
    'use strict';

    const SESSION_LABELS = Object.freeze({
        closed: 'Closed',
        asia: 'Asia',
        europe: 'Europe',
        us: 'US'
    });

    function log(message) {
        if (typeof window.addLog === 'function') {
            window.addLog(message);
        }
    }

    function resolveTradingTimeSettings(params) {
        const source = params || window.Strategy?.params || {};
        return {
            tradingOpenDayUtc: Math.max(0, Math.min(6, Number(source.tradingOpenDayUtc ?? 1))),
            tradingOpenHourUtc: Math.max(0, Math.min(23, Number(source.tradingOpenHourUtc ?? 0))),
            tradingOpenMinuteUtc: Math.max(0, Math.min(59, Number(source.tradingOpenMinuteUtc ?? 0))),
            tradingCloseDayUtc: Math.max(0, Math.min(6, Number(source.tradingCloseDayUtc ?? 5))),
            tradingCloseHourUtc: Math.max(0, Math.min(23, Number(source.tradingCloseHourUtc ?? 22))),
            tradingCloseMinuteUtc: Math.max(0, Math.min(59, Number(source.tradingCloseMinuteUtc ?? 0))),
            asiaSessionStartHourUtc: Math.max(0, Math.min(23, Number(source.asiaSessionStartHourUtc ?? 0))),
            europeSessionStartHourUtc: Math.max(0, Math.min(23, Number(source.europeSessionStartHourUtc ?? 7))),
            usSessionStartHourUtc: Math.max(0, Math.min(23, Number(source.usSessionStartHourUtc ?? 13)))
        };
    }

    function getSessionKeyForMinute(minuteOfDay, settings) {
        const markers = [
            { key: 'asia', minute: settings.asiaSessionStartHourUtc * 60 },
            { key: 'europe', minute: settings.europeSessionStartHourUtc * 60 },
            { key: 'us', minute: settings.usSessionStartHourUtc * 60 }
        ].sort((a, b) => a.minute - b.minute);

        let current = markers[markers.length - 1].key;
        for (const marker of markers) {
            if (minuteOfDay >= marker.minute) {
                current = marker.key;
            } else {
                break;
            }
        }
        return current;
    }

    function isTradingHour(timestamp, params) {
        return getSessionInfo(timestamp, params).isTradingHour;
    }

    function getSessionInfo(timestamp, params) {
        if (!timestamp) {
            return {
                isTradingHour: false,
                isWeekend: false,
                dayOfWeek: null,
                hourUtc: null,
                minuteUtc: null,
                sessionKey: 'closed',
                sessionLabel: SESSION_LABELS.closed
            };
        }

        const ts = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
        const date = new Date(ts * 1000);
        const dayOfWeek = date.getUTCDay();
        const hours = date.getUTCHours();
        const minutes = date.getUTCMinutes();
        const minuteOfDay = (hours * 60) + minutes;
        const weekMinute = (dayOfWeek * 24 * 60) + minuteOfDay;
        const settings = resolveTradingTimeSettings(params);
        const openMinute = (settings.tradingOpenDayUtc * 24 * 60) + (settings.tradingOpenHourUtc * 60) + settings.tradingOpenMinuteUtc;
        const closeMinute = (settings.tradingCloseDayUtc * 24 * 60) + (settings.tradingCloseHourUtc * 60) + settings.tradingCloseMinuteUtc;
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        let isTrading = false;
        if (openMinute === closeMinute) {
            isTrading = true;
        } else if (openMinute < closeMinute) {
            isTrading = weekMinute >= openMinute && weekMinute < closeMinute;
        } else {
            isTrading = weekMinute >= openMinute || weekMinute < closeMinute;
        }

        let sessionKey = 'closed';
        if (isTrading) {
            sessionKey = getSessionKeyForMinute(minuteOfDay, settings);
        }

        return {
            isTradingHour: isTrading,
            isWeekend,
            dayOfWeek,
            hourUtc: hours,
            minuteUtc: minutes,
            sessionKey,
            sessionLabel: SESSION_LABELS[sessionKey] || sessionKey,
            tradingTimeSettings: settings
        };
    }

    function enrichDataWithTradingHours(data, params) {
        if (!Array.isArray(data)) {
            return data;
        }

        return data.map(candle => ({
            ...candle,
            ...getSessionInfo(candle.time, params)
        }));
    }

    function createConditionContext(i, data, indicators, tradeHistory, params) {
        const activeParams = params || window.Strategy?.params || {};

        function c(lag) {
            const idx = i + lag;
            if (idx < 0 || idx >= data.length) return null;
            const candle = data[idx];
            return candle ? { ...candle, ...getSessionInfo(candle.time, activeParams) } : null;
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

            const fn = new Function('c', 'ind', 'dealStats', 'lastLossWithinTf', 'lossCountWithinPeriods',
                `let buy = 0, sell = 0;\n${rulesCode}\nreturn { buy, sell };`
            );
            const result = fn(context.c, context.ind, safeDealStats, safeLastLossWithinTf, safeLossCountWithinPeriods);
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
        getSessionInfo,
        enrichDataWithTradingHours,
        createConditionContext,
        evaluateCondition,
        evaluateRules
    };
})();
