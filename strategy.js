// strategy.js
// Strategy orchestration: running tests, markers, PnL and UI integration

(function() {
    'use strict';

    const FALLBACK_PARAMS = {
        expirationMinutes: 15,
        winPayout: 0.8,
        minEntryIntervalMultiplier: 2,
        rules: '',
        filterTradingHours: false
    };

    const STRATEGY_SETTING_KEYS = [
        'expirationMinutes',
        'winPayout',
        'minEntryIntervalMultiplier',
        'rules',
        'filterTradingHours'
    ];

    const INDICATOR_SETTING_KEYS = [
        'bbPeriod',
        'bbStdDev',
        'useMACD',
        'macdFast',
        'macdSlow',
        'macdSignal',
        'useATR',
        'atrFastPeriod',
        'atrSlowPeriod',
        'atrPeriod',
        'atrSmoothPeriod',
        'useStochastic',
        'stochasticK',
        'stochasticD',
        'stochasticSlowing'
    ];

    function log(message) {
        if (typeof window.addLog === 'function') {
            window.addLog(message);
        }
    }

    function getCore() {
        return window.StrategyCore || null;
    }

    function createDefaultParams() {
        if (window.StrategyParams && typeof window.StrategyParams.getDefaultParams === 'function') {
            return window.StrategyParams.getDefaultParams();
        }

        const core = getCore();
        if (core && typeof core.getDefaultParams === 'function') {
            return core.getDefaultParams();
        }

        return { ...FALLBACK_PARAMS };
    }

    function syncParams(params) {
        if (window.StrategyParams && typeof window.StrategyParams.normalizeParams === 'function') {
            return window.StrategyParams.normalizeParams(params || {});
        }

        const core = getCore();
        if (core && typeof core.normalizeParams === 'function') {
            return core.normalizeParams(params || {});
        }

        return { ...FALLBACK_PARAMS, ...(params || {}) };
    }

    function applyWhitelistedSettings(target, source, keys) {
        if (!source || typeof source !== 'object') {
            return false;
        }

        let changed = false;
        for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                target[key] = source[key];
                changed = true;
            }
        }

        return changed;
    }

    window.Strategy = {
        params: createDefaultParams(),
        tradeHistory: [],
        expiration: 5,
        markerBaseList: [],
        markerSeries: null,
        currentGraphicMarkerIndex: -1,
        lastIndicators: null,
        lastDataRef: null,
        entryGraphicChart: null,
        entryGraphicSeriesMid: null,
        entryGraphicSeriesUpper: null,
        entryGraphicSeriesLower: null,

        setSeriesMarkers: function(series, markers) {
            if (!series) {
                return;
            }

            if (window.LightweightCharts && typeof window.LightweightCharts.createSeriesMarkers === 'function') {
                if (series.markerPrimitive && typeof series.markerPrimitive.setMarkers === 'function') {
                    series.markerPrimitive.setMarkers(markers);
                } else {
                    series.markerPrimitive = window.LightweightCharts.createSeriesMarkers(series, markers);
                }
            } else if (typeof series.setMarkers === 'function') {
                series.setMarkers(markers);
                log('Markers created via setMarkers');
            } else {
                log('Error: no method found to display markers');
            }
        },

        ensureEntryGraphicSeries: function(chart) {
            if (!chart || !window.LightweightCharts || !window.LightweightCharts.LineSeries) {
                return;
            }

            if (this.entryGraphicChart && this.entryGraphicChart !== chart) {
                this.removeEntryGraphicSeries();
            }

            if (!this.entryGraphicSeriesMid) {
                this.entryGraphicSeriesMid = chart.addSeries(window.LightweightCharts.LineSeries, {
                    color: '#00bcd4',
                    lineWidth: 1,
                    lineStyle: 2,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false
                });
            }
            if (!this.entryGraphicSeriesUpper) {
                this.entryGraphicSeriesUpper = chart.addSeries(window.LightweightCharts.LineSeries, {
                    color: '#ff8a65',
                    lineWidth: 2,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false
                });
            }
            if (!this.entryGraphicSeriesLower) {
                this.entryGraphicSeriesLower = chart.addSeries(window.LightweightCharts.LineSeries, {
                    color: '#ff8a65',
                    lineWidth: 2,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false
                });
            }

            this.entryGraphicChart = chart;
        },

        removeEntryGraphicSeries: function() {
            if (this.entryGraphicChart) {
                if (this.entryGraphicSeriesMid) {
                    this.entryGraphicChart.removeSeries(this.entryGraphicSeriesMid);
                }
                if (this.entryGraphicSeriesUpper) {
                    this.entryGraphicChart.removeSeries(this.entryGraphicSeriesUpper);
                }
                if (this.entryGraphicSeriesLower) {
                    this.entryGraphicChart.removeSeries(this.entryGraphicSeriesLower);
                }
            }

            this.entryGraphicSeriesMid = null;
            this.entryGraphicSeriesUpper = null;
            this.entryGraphicSeriesLower = null;
            this.entryGraphicChart = null;
        },

        clearEntryGraphicLines: function() {
            if (this.entryGraphicSeriesMid) {
                this.entryGraphicSeriesMid.setData([]);
            }
            if (this.entryGraphicSeriesUpper) {
                this.entryGraphicSeriesUpper.setData([]);
            }
            if (this.entryGraphicSeriesLower) {
                this.entryGraphicSeriesLower.setData([]);
            }
        },

        showEntryGraphicForMarker: function(markerIndex) {
            this.clearEntryGraphicLines();
            this.currentGraphicMarkerIndex = -1;
        },

        clearEntryGraphic: function() {
            this.clearEntryGraphicLines();
            this.currentGraphicMarkerIndex = -1;
        },

        createConditionContext: function(i, data, indicators, tradeHistory) {
            const core = getCore();
            if (!core || typeof core.createConditionContext !== 'function') {
                log('Error: StrategyCore.createConditionContext not available');
                return null;
            }

            return core.createConditionContext(i, data, indicators, tradeHistory || this.tradeHistory, this.params);
        },

        evaluateCondition: function(condition, context) {
            const core = getCore();
            if (!core || typeof core.evaluateCondition !== 'function') {
                log('Error: StrategyCore.evaluateCondition not available');
                return false;
            }

            return core.evaluateCondition(condition, context);
        },

        calculateSignals: function(data) {
            try {
                if (!Array.isArray(data) || data.length < 30) {
                    log('Not enough data to calculate signals (minimum 30 candles required)');
                    return [];
                }

                const core = getCore();
                if (!core || typeof core.calculateIndicators !== 'function' || typeof core.calculateSignals !== 'function') {
                    log('Error: StrategyCore is not ready to calculate signals');
                    return [];
                }

                this.params = syncParams(this.params);

                if (window.debugLog) {
                    log('Debug logging enabled for calculateSignals');
                }

                const indicators = core.calculateIndicators(data, this.params);
                if (!indicators) {
                    return [];
                }

                this.lastIndicators = indicators;
                this.lastDataRef = data;

                const signals = core.calculateSignals(data, this.params, indicators, this.tradeHistory);
                return signals;
            } catch (error) {
                log(`Error calculating signals: ${error.message}`);
                return [];
            }
        },

        clearSignals: function(chart, series) {
            if (!chart || !series) {
                return;
            }

            if (series.markerPrimitive && typeof series.markerPrimitive.setMarkers === 'function') {
                series.markerPrimitive.setMarkers([]);
            } else if (typeof series.setMarkers === 'function') {
                series.setMarkers([]);
                log('Markers cleared (setMarkers)');
            } else if (window.LightweightCharts && typeof window.LightweightCharts.createSeriesMarkers === 'function') {
                window.LightweightCharts.createSeriesMarkers(series, []);
            } else {
                log('Failed to clear markers: no suitable method');
            }

            if (window.MARKER_TIMESTAMPS) {
                window.MARKER_TIMESTAMPS.length = 0;
                if (window.curM !== undefined) window.curM = 0;
            }

            this.markerBaseList = [];
            this.markerSeries = null;
            this.currentGraphicMarkerIndex = -1;
            this.clearEntryGraphicLines();
            this.removeEntryGraphicSeries();
        },

        plotSignals: function(chart, series, signals) {
            if (!chart || !series) {
                log('Error: chart or series not available to display markers');
                return;
            }
            if (!signals || signals.length === 0) {
                log('No signals to display');
                return;
            }
            
            // Create maps of trade results and stakes by time and type for quick lookup
            const tradeResultMap = {};
            const tradeStakeMap = {};
            if (this.tradeHistory && Array.isArray(this.tradeHistory)) {
                for (const trade of this.tradeHistory) {
                    const key = `${trade.time}_${trade.type}`;
                    tradeResultMap[key] = trade.result; // 'win' or 'loss'
                    tradeStakeMap[key] = Number(trade.stake) || 0;
                }
            }

            const markers = [];
            signals.forEach(signal => {
                const strength = signal.type === 'buy' ? signal.buyStrength : signal.sellStrength;

                // Determine marker color by trade result
                // Use actualEntryTime if available, otherwise use signal.time
                const actualEntryTime = signal.entryTime !== undefined ? signal.entryTime : signal.time;
                const tradeKey = `${actualEntryTime}_${signal.type}`;
                const tradeResult = tradeResultMap[tradeKey];
                const dealSize = tradeStakeMap[tradeKey] || (Number(strength) || 1);
                const dealSizeText = dealSize.toFixed(1);
                
                let markerColor;
                if (tradeResult === 'win') {
                    markerColor = '#26a69a'; // Green for win (from MACD)
                } else if (tradeResult === 'loss') {
                    markerColor = '#ef5350'; // Red for loss (from MACD)
                } else {
                    // If result unknown, use color by type
                    markerColor = signal.type === 'buy' ? '#26a69a' : '#ef5350';
                }

                // Entry marker with sum
                markers.push({
                    time: signal.time,
                    position: signal.type === 'buy' ? 'belowBar' : 'aboveBar',
                    color: markerColor,
                    shape: signal.type === 'buy' ? 'arrowUp' : 'arrowDown',
                    text: dealSizeText
                });
                
                // Close marker on close candle
                if (signal.closeTime !== undefined) {
                    markers.push({
                        time: signal.closeTime,
                        position: signal.type === 'buy' ? 'belowBar' : 'aboveBar',
                        color: markerColor,
                        shape: 'diamond'
                    });
                }
            });

            this.markerBaseList = markers.slice();
            this.markerSeries = series;
            this.currentGraphicMarkerIndex = -1;
            this.clearEntryGraphicLines();

            if (window.MARKER_TIMESTAMPS) {
                window.MARKER_TIMESTAMPS.splice(0, window.MARKER_TIMESTAMPS.length, ...signals.map(signal => signal.time));
                if (window.curM !== undefined) window.curM = 0;
            }

            this.setSeriesMarkers(series, markers);
        },

        calculatePnL: function(data, signals, initialDeposit = 100, tradeAmount = 1, winCoefficient = null, options = {}) {
            this.params = syncParams(this.params);
            if (winCoefficient === null) {
                winCoefficient = Number(this.params.winPayout ?? 0.8);
            }
            const shouldLogSummary = options.logSummary !== false;
            this.tradeHistory = [];
            window.tradeHistory = this.tradeHistory;

            const balance = [];
            let currentBalance = initialDeposit;

                if (!signals || signals.length === 0) {
                for (let i = 0; i < data.length; i++) {
                    balance.push({
                        time: data[i].time,
                        value: currentBalance
                    });
                }
                window.lastBalance = balance;
                if (shouldLogSummary) {
                    log(`Balance (no trades): ${currentBalance.toFixed(2)}`);
                }
                return balance;
            }

            const expirationSeconds = this.getExpiration() * 60;
            const profitByCandleIndex = {};

            // Построить карту time→index для O(1) поиска вместо findIndex O(n)
            const timeIndexMap = new Map();
            for (let idx = 0; idx < data.length; idx++) {
                timeIndexMap.set(data[idx].time, idx);
            }

            for (const signal of signals) {
                // Use entryTime if available (actual entry), otherwise use signal.time (marker time)
                const actualEntryTime = signal.entryTime !== undefined ? signal.entryTime : signal.time;
                const entryIndex = timeIndexMap.get(actualEntryTime);
                if (entryIndex === undefined) {
                    log(`Signal with time ${actualEntryTime} not found in data`);
                    continue;
                }

                const entryPrice = signal.price;
                const closeTime = actualEntryTime + expirationSeconds;
                let closeIndex = -1;
                let closePrice = null;

                // If result already computed in calculateSignals, use it
                let isWin = false;
                if (signal.tradeResult !== undefined) {
                    isWin = signal.tradeResult === 'win';
                    // Find the close index from signal data
                    if (signal.closeTime !== undefined) {
                        for (let i = entryIndex; i < data.length; i++) {
                            if (data[i].time === signal.closeTime) {
                                closeIndex = i;
                                closePrice = data[i].close;
                                break;
                            }
                        }
                    }
                    if (closeIndex === -1) {
                        // Fallback: search by closeTime if signal.closeTime not available
                        for (let i = entryIndex; i < data.length; i++) {
                            if (data[i].time > closeTime) {
                                closeIndex = i;
                                break;
                            }
                        }
                        if (closeIndex === -1) {
                            closeIndex = data.length - 1;
                        }
                        closePrice = data[closeIndex].close;
                    }
                } else {
                    // Compute result (for signals not yet closed in calculateSignals)
                    for (let i = entryIndex; i < data.length; i++) {
                        if (data[i].time > closeTime) {
                            closeIndex = i;
                            break;
                        }
                    }

                    if (closeIndex === -1) {
                        closeIndex = data.length - 1;
                    }

                    closePrice = data[closeIndex].close;

                    if (signal.type === 'buy') {
                        isWin = closePrice > entryPrice;
                    } else if (signal.type === 'sell') {
                        isWin = closePrice < entryPrice;
                    }
                }

                const strength = signal.type === 'buy' ? signal.buyStrength : signal.sellStrength;
                const stake = Math.max(0, Number(tradeAmount) || 1) * (Number(strength) || 1);
                const profit = isWin ? stake * winCoefficient : -stake;

                if (!profitByCandleIndex[closeIndex]) {
                    profitByCandleIndex[closeIndex] = 0;
                }
                profitByCandleIndex[closeIndex] += profit;

                this.tradeHistory.push({
                    time: actualEntryTime,
                    type: signal.type,
                    price: entryPrice,
                    closeTime: data[closeIndex].time,
                    closePrice: closePrice,
                    result: isWin ? 'win' : 'loss',
                    profit: profit,
                    stake,
                    expiration: expirationSeconds / 60
                });
            }

            for (let i = 0; i < data.length; i++) {
                if (profitByCandleIndex[i] !== undefined) {
                    currentBalance += profitByCandleIndex[i];
                }
                balance.push({
                    time: data[i].time,
                    value: currentBalance
                });
            }

            window.lastBalance = balance;
            const totalTrades = this.tradeHistory.length;
            const wins = this.tradeHistory.filter(t => t.result === 'win').length;
            const losses = this.tradeHistory.filter(t => t.result === 'loss').length;
            const winrate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
            if (shouldLogSummary) {
                log(`Final balance: ${currentBalance.toFixed(2)} (trades: ${totalTrades}, win: ${wins}, loss: ${losses}, winrate: ${winrate.toFixed(2)}%)`);
            }
            return balance;
        },

        testStrategy: function() {
            if (!window.data || window.data.length === 0) {
                log('No data to test strategy');
                return;
            }

            // Даем UI отрисовать лог до тяжелых синхронных расчетов
            setTimeout(() => {
                const viewportState = typeof window.captureViewportState === 'function'
                    ? window.captureViewportState()
                    : null;

                if (typeof window.applyAllSettings === 'function') {
                    window.applyAllSettings();
                } else {
                    log('Warning: applyAllSettings function not found');
                }

                // Each backtest run should start with a clean trade history,
                // otherwise dealStats() in rules will account for previous runs.
                this.tradeHistory = [];
                window.tradeHistory = this.tradeHistory;

                const signals = this.calculateSignals(window.data);

                window.lastSignals = signals;

                // Рассчитываем PnL ПЕРЕД отображением маркеров, чтобы знать результаты сделок
                const winPayout = this.params?.winPayout ?? 0.8;
                this.calculatePnL(window.data, signals, 100, 1, winPayout, { logSummary: true });

                // Теперь отображаем маркеры с информацией о результатах
                if (window.chartMain && window.candleSeries) {
                    this.clearSignals(window.chartMain, window.candleSeries);
                }

                if (window.chartMain && window.candleSeries) {
                    this.plotSignals(window.chartMain, window.candleSeries, signals);
                }

                // Render indicator signals panel using strategy's signals evaluator
                if (typeof window.renderSignalsPane === 'function') {
                    try {
                        const core = window.StrategyCore;
                        const signalPaneData = core && typeof core.calculateSignalPaneData === 'function'
                            ? core.calculateSignalPaneData(window.data, this.params, null)
                            : [];
                        window.renderSignalsPane(window.data, signalPaneData);
                    } catch (error) {
                        log(`Error rendering signals pane: ${error.message}`);
                    }
                }

                if (typeof window.updateBalance === 'function') {
                    window.updateBalance();
                }

                if (viewportState && typeof window.restoreViewportState === 'function') {
                    window.restoreViewportState(viewportState);
                }
            }, 0);
        },

        setExpiration: function(minutes) {
            this.expiration = minutes;
            this.params = syncParams(this.params);
            this.params.expirationMinutes = minutes;
            log(`Время экспирации установлено: ${minutes} минут`);
        },

        getExpiration: function() {
            this.params = syncParams(this.params);
            return Number(this.params.expirationMinutes || this.expiration || 5);
        },

        applyStrategySettings: function(settings) {
            this.params = syncParams(this.params);
            if (applyWhitelistedSettings(this.params, settings, STRATEGY_SETTING_KEYS)) {
                log('Настройки стратегии применены');
            }
        },

        applyIndicatorSettings: function(settings) {
            this.params = syncParams(this.params);
            if (applyWhitelistedSettings(this.params, settings, INDICATOR_SETTING_KEYS)) {
                log('Настройки индикаторов применены');
            }
        },

        updateFromCore: function() {
            // Синхронизировать params с последними значениями из StrategyCore/StrategyParams
            // Это необходимо, чтобы новые значения индикаторов (bbPeriod, bbStdDev)
            // из текущего strategy-файла были доступны для renderBB и других функций
            const coreParams = createDefaultParams();
            if (coreParams && typeof coreParams === 'object') {
                this.params = { ...coreParams };
                log('Параметры синхронизированы с StrategyCore');
            }
        },

    };
})();