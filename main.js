// main.js - Main application logic

const SCALE_WIDTH = 80;
let data = [];
window.data = data; // expose globally
let MARKER_TIMESTAMPS = [];
window.MARKER_TIMESTAMPS = MARKER_TIMESTAMPS; // экспорт для strategy.js
let currentRange = '3M', currentTimeframe = '5m', currentSource = 'none', currentPair = '', curM = 0, isSyncing = false;
window.curM = curM; // экспорт для strategy.js
const activePanes = {}, mainSeriesRefs = {};

const addLog = (m) => {
    const c = document.getElementById('log-content');
    if (c) {
        c.innerHTML += `<div><span style=\"color:#5d606b\">[${new Date().toLocaleTimeString()}]</span> ${m}</div>`;
        c.scrollTop = c.scrollHeight;
    }
};
window.addLog = addLog;
// Data utilities for range/timeframe calculations
window.DataUtils = {
    // Minutes in each range (assuming 24h days, 7 days week, 30 days month, 365 days year)
    RANGE_MINUTES: {
        '1D': 24 * 60,          // 1440
        '1W': 7 * 24 * 60,      // 10080
        '1M': 30 * 24 * 60,     // 43200
        '3M': 3 * 30 * 24 * 60, // 129600
        '1Y': 365 * 24 * 60     // 525600
    },
    // Minutes in each timeframe (short format)
    TIMEFRAME_MINUTES: {
        '1m': 1,
        '5m': 5,
        '15m': 15,
        '1H': 60,
    },
    // Calculate number of candles needed for given range and timeframe
    calculateOutputSize: function(range, timeframe) {
        const rangeMinutes = this.RANGE_MINUTES[range];
        const timeframeMinutes = this.TIMEFRAME_MINUTES[timeframe];
        if (!rangeMinutes || !timeframeMinutes) {
            addLog(`Предупреждение: неизвестный диапазон или таймфрейм: ${range}, ${timeframe}`);
            return 100; // fallback
        }
        const candles = Math.ceil(rangeMinutes / timeframeMinutes);
        // Global cap to prevent excessive memory usage in chart rendering
        const MAX_OUTPUTSIZE = 200000;
        return Math.min(candles, MAX_OUTPUTSIZE);
    },
    // Map timeframe to Twelve Data interval string (convert short format to API format)
    mapTimeframeToInterval: function(timeframe) {
        const intervalMap = {
            '1m': '1min',
            '5m': '5min',
            '15m': '15min',
            '1H': '1h',
            '4H': '4h',
            '1D': '1day',
            '1W': '1week',
            '1M': '1month'
        };
        return intervalMap[timeframe] || '1day';
    }
};



// Chart configuration
const chartOpts = {
    layout: { background: { color: '#131722' }, textColor: '#d1d4dc' },
    rightPriceScale: { borderColor: '#363c4e', minimumWidth: SCALE_WIDTH },
    grid: { vertLines: { visible: false }, horzLines: { color: '#242733' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Hidden },
    timeScale: { borderColor: '#363c4e', timeVisible: true, rightOffset: 80 }
};

const chartMain = LightweightCharts.createChart(document.getElementById('chart-main'), chartOpts);
window.chartMain = chartMain;
const candleSeries = chartMain.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: '#26a69a', downColor: '#ef5350', lastValueVisible: false, priceLineVisible: false});
window.candleSeries = candleSeries;

window.onresize = () => { 
    const container = document.getElementById('main-pane');
    if (!container) return;
    chartMain.resize(container.clientWidth, container.clientHeight); 
    Object.entries(activePanes).forEach(([id, p]) => {
        const wrapper = document.getElementById('wrapper-' + id);
        const paneHeight = wrapper ? wrapper.clientHeight : 130;
        p.chart.resize(container.clientWidth, paneHeight);
    });
};

let hasAutoStartedStrategyOnFirstOpen = false;

async function autoStartStrategyAndBalanceOnFirstOpen() {
    if (hasAutoStartedStrategyOnFirstOpen) {
        return;
    }
    if (!Array.isArray(window.data) || window.data.length === 0) {
        addLog('Автозапуск стратегии пропущен: нет данных');
        return;
    }

    const maxAttempts = 10;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (window.Strategy && typeof window.Strategy.testStrategy === 'function') {
            hasAutoStartedStrategyOnFirstOpen = true;

            const ensureIndicatorEnabled = (id) => {
                const cb = document.querySelector(`#indicator-menu input[data-id="${id}"]`);
                if (!cb) return;
                if (!cb.checked) {
                    cb.checked = true;
                }
                if (typeof window.toggleIndicator === 'function') {
                    window.toggleIndicator(id, true);
                }
            };

            const ensureIndicatorDisabled = (id) => {
                const cb = document.querySelector(`#indicator-menu input[data-id="${id}"]`);
                if (!cb) return;
                if (cb.checked) {
                    cb.checked = false;
                }
                if (typeof window.toggleIndicator === 'function') {
                    window.toggleIndicator(id, false);
                }
            };

            // Read params (prefer Strategy.params if strategy already initialized,
            // otherwise use StrategyParams defaults) and enable indicators accordingly.
            const strategyParams = (window.Strategy && window.Strategy.params)
                || (window.StrategyParams && typeof window.StrategyParams.getDefaultParams === 'function'
                    ? window.StrategyParams.getDefaultParams()
                    : {});

            const idMap = {
                useSMA: 'SMA',
                useBB: 'BB',
                useATR: 'ATR',
                useMACD: 'MACD',
                useStochastic: 'Stochastic'
            };

            Object.entries(idMap).forEach(([flag, id]) => {
                const want = Boolean(strategyParams[flag]);
                if (want) {
                    ensureIndicatorEnabled(id);
                } else {
                    ensureIndicatorDisabled(id);
                }
            });

            // Start strategy after indicators are set
            window.Strategy.testStrategy();

            const balanceCheckbox = document.querySelector('#indicator-menu input[data-id="Balance"]');
            if (balanceCheckbox && !balanceCheckbox.checked) {
                balanceCheckbox.checked = true;
            }
            if (typeof window.toggleBalance === 'function') {
                window.toggleBalance(true);
            }
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    }

    addLog('Автозапуск стратегии не выполнен: Strategy еще не готов');
}

function scheduleAutoStartStrategyAndBalanceOnFirstOpen() {
    const run = () => {
        autoStartStrategyAndBalanceOnFirstOpen().catch(err => {
            addLog(`Ошибка автозапуска стратегии: ${err.message}`);
        });
    };

    // Отложить тяжелый расчёт до первого кадра, чтобы интерфейс открылся быстрее.
    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => setTimeout(run, 0));
        return;
    }

    setTimeout(run, 0);
}

window.toggleLog = () => { 
    document.getElementById('log-panel').classList.toggle('collapsed'); 
    setTimeout(window.onresize, 50); 
};

window.setRange = (r) => {
    currentRange = r;
    document.getElementById('range-btn').innerText = r + ' ▾';
    addLog(`Range set to: ${r}`);
    reloadDataIfNeeded();
};

window.setTimeframe = async (tf) => {
    currentTimeframe = tf;
    // Обновить текст кнопки TF (например, "m1 ▾")
    const displayMap = { '1m': 'm1', '5m': 'm5', '15m': 'm15' };
    const display = displayMap[tf] || tf;
    const tfBtn = document.getElementById('tf-btn');
    if (tfBtn) tfBtn.innerText = display + ' ▾';
    addLog(`Timeframe set to: ${tf}`);
    // Обновить список пар для текущего источника
    await updatePairListForCurrentSource();
    // Перезагрузить данные, если источник выбран
    reloadDataIfNeeded();
};

function reloadDataIfNeeded() {
    if (currentSource !== 'none' && currentPair) {
        // Перезагрузить данные с текущими параметрами
        window.setPair(currentPair);
    }
}

async function updatePairListForCurrentSource() {
    if (currentSource === 'none') {
        // Очистить список пар
        renderPairs([]);
        return;
    }
    if (currentSource === 'twelvedata' && window.TwelveDataProvider) {
        const pairs = window.TwelveDataProvider.getPairs();
        renderPairs(pairs);
    } else if (currentSource === 'local' && window.LocalJsProvider) {
        // Фильтруем пары по текущему TF
        const pairs = await window.LocalJsProvider.getPairsByTimeframe(currentTimeframe);
        if (pairs.length === 0) {
            // Если для данного TF нет файлов, очищаем список пар и график
            renderPairs([]);
            // Также очищаем график, если пара была выбрана
            if (currentPair) {
                data = []; window.data = data;
                candleSeries.setData([]);
                Object.keys(mainSeriesRefs).forEach(id => { mainSeriesRefs[id].forEach(s => chartMain.removeSeries(s)); delete mainSeriesRefs[id]; });
                Object.keys(activePanes).forEach(id => { activePanes[id].chart.remove(); document.getElementById(`wrapper-${id}`)?.remove(); delete activePanes[id]; });
                currentPair = '';
                document.getElementById('pair-btn').innerText = 'Select ▾';
                addLog('No pairs for selected timeframe, cleared chart.');
            }
        } else {
            renderPairs(pairs);
        }
    }
}

function renderPairs(pairs) {
    const drop = document.getElementById('pair-dropdown');
    if (!drop) return;
    drop.innerHTML = pairs.length ? '' : '<div class=\"ind-row\">No pairs found</div>';
    pairs.forEach(p => { 
        const el = document.createElement('div'); 
        el.className = 'ind-row'; 
        el.innerText = p; 
        el.onclick = () => window.setPair(p); 
        drop.appendChild(el); 
    });
}

window.setDataSource = async (type) => {
    currentSource = type;
    document.getElementById('source-btn').innerText = (type === 'none' ? 'SOURCE' : type.toUpperCase()) + ' ▾';
    if (type === 'none') {
        data = []; window.data = data; candleSeries.setData([]);
        Object.keys(mainSeriesRefs).forEach(id => { mainSeriesRefs[id].forEach(s => chartMain.removeSeries(s)); delete mainSeriesRefs[id]; });
        Object.keys(activePanes).forEach(id => { activePanes[id].chart.remove(); document.getElementById(`wrapper-${id}`)?.remove(); delete activePanes[id]; });
        document.querySelectorAll('#indicator-menu input[type=\"checkbox\"]').forEach(cb => cb.checked = false);
        addLog("Source cleared.");
        // Очистить список пар
        renderPairs([]);
    } else if (type === 'twelvedata' && window.TwelveDataProvider) {
        addLog("Initializing Twelve Data API connection...");
        if (await window.TwelveDataProvider.requestAccess()) {
            await updatePairListForCurrentSource();
        }
    } else if (type === 'local' && window.LocalJsProvider) {
        addLog("Initializing Local data...");
        if (await window.LocalJsProvider.requestAccess()) {
            await updatePairListForCurrentSource();
        }
    }
    window.onresize();
};

window.setPair = async (p) => {
    currentPair = p;
    document.getElementById('pair-btn').innerText = p + ' ▾';
    let provider = null;
    if (currentSource === 'twelvedata') provider = window.TwelveDataProvider;
    else if (currentSource === 'local') provider = window.LocalJsProvider;
    if (provider) {
        addLog(`Fetching data: ${p}, Range: ${currentRange}, Timeframe: ${currentTimeframe}`);
        const newData = await provider.fetchData(currentRange, currentTimeframe, p);
        if (!newData || !newData.length) return addLog("No data received");
        data = newData;
        // Обогатить данные признаком торговых часов (если StrategyCore доступен)
        if (window.StrategyCore && window.StrategyCore.enrichDataWithTradingHours) {
            data = window.StrategyCore.enrichDataWithTradingHours(data);
        }
        window.data = data;
        candleSeries.setData(data);
        chartMain.timeScale().fitContent();
        // Очистить маркеры сигналов
        if (window.Strategy && window.chartMain && window.candleSeries) {
            window.Strategy.clearSignals(window.chartMain, window.candleSeries);
        }
        // Сбросить сигналы
        window.lastSignals = [];
        // Очистить массив временных меток маркеров
        window.MARKER_TIMESTAMPS.length = 0;
        curM = 0;
        window.curM = curM;
        // Обновить график баланса, если он активен
        if (activePanes.Balance && typeof window.updateBalance === 'function') {
            window.updateBalance();
        }
        document.querySelectorAll('#indicator-menu input[type=\"checkbox\"]').forEach(cb => {
            if(cb.checked) window.toggleIndicator(cb.getAttribute('data-id'), true);
        });
        updateIndicatorValues();

        // Re-apply full-range viewport after indicator refresh/sync side effects.
        chartMain.timeScale().fitContent();

        addLog(`Loaded ${p}: ${data.length} candles (Range: ${currentRange}, TF: ${currentTimeframe})`);
    }
};

function updateIndicatorValues(options = {}) {
    if (!data.length) return;

    const indicatorValueFieldIds = [
        'buy-macd-val',
        'buy-signal-val',
        'buy-histogram-val',
        'sell-macd-val',
        'sell-signal-val',
        'sell-histogram-val',
        'buy-stochasticK-val',
        'buy-stochasticD-val',
        'sell-stochasticK-val',
        'sell-stochasticD-val'
    ];
    const hasIndicatorValueTargets = indicatorValueFieldIds.some(id => document.getElementById(id));
    if (!options.force && !hasIndicatorValueTargets) return;

    const ts = chartMain.timeScale();
    const mainPane = document.getElementById('main-pane');
    const logicalIndex = ts.coordinateToLogical((mainPane.clientWidth - SCALE_WIDTH) / 2);
    if (logicalIndex === null) return;
    const idx = Math.round(logicalIndex);
    const candle = data[idx];
    if (!candle) return;

    const coreDefaults = window.StrategyCore && typeof window.StrategyCore.getDefaultParams === 'function'
        ? window.StrategyCore.getDefaultParams()
        : {};
    const params = { ...coreDefaults, ...(window.Strategy?.params || {}) };

    let indicators = null;
    if (window.StrategyCore && typeof window.StrategyCore.calculateIndicators === 'function') {
        indicators = window.StrategyCore.calculateIndicators(data, params, {
            only: ['sma', 'bb', 'macd', 'stochastic'],
            forceAll: true,
            silent: true
        });
    }

    if (!indicators) {
        indicators = {
            sma: window.calcSMA(data, params.smaPeriod || 20),
            bb: window.calcBB(data, params.bbPeriod || 20, params.bbStdDev || 2),
            macd: window.calcMACD(data, params.macdFast || 12, params.macdSlow || 26, params.macdSignal || 9),
            stochastic: window.calcStochastic(data, params.stochasticK || 14, params.stochasticD || 3, params.stochasticSlowing || 3)
        };
    }

    // Получить значения для текущего индекса
    const smaVal = indicators.sma[idx]?.value;
    const bbUpper = indicators.bb[idx]?.upper;
    const bbMiddle = indicators.bb[idx]?.middle;
    const bbLower = indicators.bb[idx]?.lower;
    const macdVal = indicators.macd[idx]?.macd;
    const macdSignalVal = indicators.macd[idx]?.signal;
    const macdHist = indicators.macd[idx]?.histogram;
    const stochK = indicators.stochastic[idx]?.k;
    const stochD = indicators.stochastic[idx]?.d;

    // Форматирование
    const format = (v, digits = 5) => (v === null || v === undefined || !Number.isFinite(v)) ? '—' : v.toFixed(digits);
    const formatPercent = (v) => (v === null || v === undefined || !Number.isFinite(v)) ? '—' : v.toFixed(2) + '%';

    // Обновить DOM элементы для переменных покупки и продажи
    const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    };

    // MACD значения
    setText('buy-macd-val', format(macdVal, 5));
    setText('buy-signal-val', format(macdSignalVal, 5));
    setText('buy-histogram-val', format(macdHist, 5));
    setText('sell-macd-val', format(macdVal, 5));
    setText('sell-signal-val', format(macdSignalVal, 5));
    setText('sell-histogram-val', format(macdHist, 5));

    // Stochastic значения
    setText('buy-stochasticK-val', formatPercent(stochK));
    setText('buy-stochasticD-val', formatPercent(stochD));
    setText('sell-stochasticK-val', formatPercent(stochK));
    setText('sell-stochasticD-val', formatPercent(stochD));


    // Сохранить текущие значения переменных для вставки
    window.currentIndicatorValues = {
        macdVal,
        macdSignalVal,
        macdHist,
        stochK,
        stochD,
        smaVal,
        bbUpper,
        bbMiddle,
        bbLower,
        close: candle.close,
        open: candle.open,
        high: candle.high,
        low: candle.low
    };
}

window.updateIndicatorValues = updateIndicatorValues;


/**
 * Синхронизирует видимый логический диапазон всех графиков (основного и индикаторных панелей).
 * Использует логические диапазоны (getVisibleLogicalRange / setVisibleLogicalRange) для точного совмещения
 * свечей и индикаторов, что предотвращает визуальное смещение.
 * Важно: чтобы синхронизация работала корректно, массивы данных индикаторов должны иметь ту же длину,
 * что и основной массив свечей, и сохранять соответствие по времени. Для периодов, где индикатор не определён,
 * следует передавать значение null (а не фильтровать элементы), иначе логические индексы разойдутся.
 */
function syncAll(source) {
    if (isSyncing) return;
    isSyncing = true;
    const range = source.timeScale().getVisibleLogicalRange();
    if (range) {
        [chartMain, ...Object.values(activePanes).map(p => p.chart)].forEach(c => {
            if (c && c !== source) c.timeScale().setVisibleLogicalRange(range);
        });
    }
    updateIndicatorValues();
    isSyncing = false;
}

chartMain.timeScale().subscribeVisibleLogicalRangeChange(() => syncAll(chartMain));

// Делегирует переключение/отрисовку индикаторов в IndicatorRenderers.
// main.js сохраняет роль оркестратора и передаёт только контекст (данные, параметры, графики, callbacks).
window.toggleIndicator = function(id, isChecked) {
    const coreDefaults = window.StrategyCore && typeof window.StrategyCore.getDefaultParams === 'function'
        ? window.StrategyCore.getDefaultParams()
        : {};
    const params = { ...coreDefaults, ...(window.Strategy?.params || {}) };

    if (window.IndicatorRenderers && typeof window.IndicatorRenderers.toggleIndicator === 'function') {
        window.IndicatorRenderers.toggleIndicator({
            id,
            isChecked,
            data,
            params,
            chartMain,
            chartOpts,
            mainSeriesRefs,
            activePanes,
            syncAll,
            onResize: window.onresize,
            addLog,
            LightweightCharts
        });
        return;
    }

    addLog('IndicatorRenderers не инициализирован');
};


// Включение/выключение графика баланса
window.toggleBalance = function(isChecked) {
    if (!isChecked) {
        // Удалить панель Balance
        if (activePanes.Balance) {
            activePanes.Balance.chart.remove();
            document.getElementById('wrapper-Balance')?.remove();
            delete activePanes.Balance;
            window.onresize();
        }
        return;
    }
    if (!data.length) {
        addLog('Нет данных для расчета баланса');
        return;
    }
    // Рассчитать PnL (если сигналов нет, будет отображен постоянный баланс)
    const winPayout = window.Strategy?.params?.winPayout ?? 0.8;
    const balanceData = window.Strategy.calculatePnL(data, window.lastSignals || [], 100, 1, winPayout, { logSummary: false });
    if (!balanceData || balanceData.length === 0) {
        addLog('Не удалось рассчитать баланс');
        return;
    }
    // Создать панель для Balance, если её нет
    if (!activePanes.Balance) {
        const wr = document.createElement('div');
        wr.id = 'wrapper-Balance';
        wr.className = 'pane-wrapper sub-pane';
        wr.style.height = '65px';
        wr.innerHTML = `<div class="v-line"></div><div id="chart-Balance" class="chart-container"></div>`;
        document.getElementById('panels-container').appendChild(wr);
        const chart = LightweightCharts.createChart(document.getElementById('chart-Balance'), {
            layout: { background: { color: '#131722' }, textColor: '#d1d4dc' },
            rightPriceScale: { borderColor: '#363c4e', minimumWidth: 80 },
            grid: { vertLines: { visible: false }, horzLines: { color: '#242733' } },
            crosshair: { mode: LightweightCharts.CrosshairMode.Hidden },
            timeScale: { visible: false }
        });
        chart.timeScale().subscribeVisibleLogicalRangeChange(() => syncAll(chart));
        activePanes.Balance = { chart, series: [] };
    }
    const pane = activePanes.Balance;
    pane.series.forEach(s => pane.chart.removeSeries(s));
    pane.series = [];
    const series = pane.chart.addSeries(LightweightCharts.LineSeries, {
        color: '#00ff00',
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false
    });
    series.setData(balanceData);
    pane.series.push(series);
    pane.chart.timeScale().fitContent();
    window.onresize();
    syncAll(chartMain);
};

// Обновить график баланса (если активен) на основе текущих сигналов
window.updateBalance = function() {
    if (!activePanes.Balance) {
        // График баланса не активен
        return;
    }
    if (!data.length) {
        addLog('Нет данных для обновления баланса');
        return;
    }
    // Рассчитать PnL (если сигналов нет, будет отображен постоянный баланс)
    const winPayout = window.Strategy?.params?.winPayout ?? 0.8;
    const balanceData = window.Strategy.calculatePnL(data, window.lastSignals || [], 100, 1, winPayout, { logSummary: false });
    if (!balanceData || balanceData.length === 0) {
        addLog('Не удалось рассчитать баланс');
        return;
    }
    const pane = activePanes.Balance;
    pane.series.forEach(s => pane.chart.removeSeries(s));
    pane.series = [];
    const series = pane.chart.addSeries(LightweightCharts.LineSeries, {
        color: '#00ff00',
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false
    });
    series.setData(balanceData);
    pane.series.push(series);
    pane.chart.timeScale().fitContent();
    syncAll(chartMain);
};

// Initialize with default values
window.onresize();

// Auto‑load local data if available
(async function init() {
    // Wait a bit for all scripts to load
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Use LocalJsProvider to scan available modules
    const datasets = window.LocalJsProvider ? await window.LocalJsProvider.scanModules() : [];
    const defaultModuleSuffix = '/EURUSD_M5_data.js';
    let targetPair = 'EUR/USD';
    let targetDataset = datasets.find(ds => typeof ds.variable === 'string' && ds.variable.endsWith(defaultModuleSuffix)) || null;

    // Fallback: EUR/USD on 5m
    if (!targetDataset) {
        targetDataset = datasets.find(ds => ds.pair === targetPair && ds.timeframe === '5m') || null;
    }

    // Fallback: EUR/USD on any timeframe
    if (!targetDataset) {
        targetDataset = datasets.find(ds => ds.pair === targetPair) || null;
    }
    // If not found, fallback to first dataset (if any)
    if (!targetDataset && datasets.length > 0) {
        targetDataset = datasets[0];
        targetPair = targetDataset.pair;
    }
    
    if (targetDataset) {
        const pair = targetDataset.pair;

        // Force requested defaults
        window.setRange('3M');
        await window.setTimeframe('5m');
        
        // Set source to local
        await window.setDataSource('local');
        
        // Wait for pairs to be rendered
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Set pair
        await window.setPair(pair);

        scheduleAutoStartStrategyAndBalanceOnFirstOpen();
        
        addLog(`Auto-loaded ${pair} (5m) from local data, range 3M.`);
    } else {
        // No local data, start with empty source
        window.setDataSource('none');
        addLog('No local data found, starting with empty source.');
    }
})();

// Открыть/закрыть панель настроек
window.toggleSettings = function() {
    const panel = document.getElementById('settings-panel');
    if (!panel) {
        addLog('Ошибка: панель настроек не найдена в toggleSettings');
        return;
    }

    panel.classList.toggle('open');
};

// Навигация по маркерам
function getVisibleLogicalRangeSafe() {
    return chartMain.timeScale().getVisibleLogicalRange();
}

function findNearestMarkerIndexByCenter() {
    if (!window.MARKER_TIMESTAMPS || window.MARKER_TIMESTAMPS.length === 0) {
        return -1;
    }

    const visibleRange = getVisibleLogicalRangeSafe();
    if (!visibleRange || !data || data.length === 0) {
        return Math.max(0, Math.min(curM, window.MARKER_TIMESTAMPS.length - 1));
    }

    const centerLogical = (visibleRange.from + visibleRange.to) / 2;
    const centerIndex = Math.max(0, Math.min(data.length - 1, Math.round(centerLogical)));
    const centerTime = data[centerIndex].time;

    let nearestIndex = 0;
    let nearestDistance = Infinity;
    for (let i = 0; i < window.MARKER_TIMESTAMPS.length; i++) {
        const distance = Math.abs(window.MARKER_TIMESTAMPS[i] - centerTime);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = i;
        }
    }

    return nearestIndex;
}

function centerOnDataIndexPreserveScale(targetIndex) {
    const ts = chartMain.timeScale();
    const visibleRange = getVisibleLogicalRangeSafe();
    if (!visibleRange) {
        return false;
    }

    const span = visibleRange.to - visibleRange.from;
    const halfSpan = span / 2;
    let from = targetIndex - halfSpan;
    let to = targetIndex + halfSpan;

    if (from < 0) {
        to -= from;
        from = 0;
    }

    const maxIndex = Math.max(0, data.length - 1);
    if (to > maxIndex) {
        const shift = to - maxIndex;
        from = Math.max(0, from - shift);
        to = maxIndex;
    }

    ts.setVisibleLogicalRange({ from, to });
    return true;
}

window.changeMarker = function(dir) {
    if (!window.MARKER_TIMESTAMPS || window.MARKER_TIMESTAMPS.length === 0) {
        addLog('Нет маркеров для навигации');
        return;
    }

    const markersCount = window.MARKER_TIMESTAMPS.length;
    const baseIndex = findNearestMarkerIndexByCenter();

    if (dir === 'first') {
        curM = 0;
    } else if (dir === 'last') {
        curM = markersCount - 1;
    } else if (typeof dir === 'number') {
        curM = (baseIndex + dir + markersCount) % markersCount;
    } else {
        addLog('Неизвестное направление навигации');
        return;
    }

    window.curM = curM;
    const markerTime = window.MARKER_TIMESTAMPS[curM];
    const markerDataIndex = data.findIndex(candle => candle.time === markerTime);

    if (markerDataIndex === -1) {
        addLog('Маркер не найден в текущих данных');
        return;
    }

    if (!centerOnDataIndexPreserveScale(markerDataIndex)) {
        addLog('Не удалось выполнить переход без изменения масштаба');
        return;
    }

};

// Переход к началу графика (сохраняет текущий масштаб)
window.navigateToStart = function() {
    if (!data || data.length === 0) {
        addLog('Нет данных для навигации');
        return;
    }
    const ts = chartMain.timeScale();
    const visibleRange = ts.getVisibleLogicalRange();
    if (!visibleRange) {
        addLog('Переход к началу невозможен: видимый диапазон не определён');
        return;
    }
    // Вычислить длину видимого диапазона в логических единицах (индексах свечей)
    const length = visibleRange.to - visibleRange.from;
    // Установить новый диапазон с той же длиной, но начинающийся с первой свечи
    const newFrom = 0;
    const newTo = Math.min(length, data.length - 1);
    ts.setVisibleLogicalRange({ from: newFrom, to: newTo });
    addLog('Переход к началу графика');
};

// Переход к концу графика (сохраняет текущий масштаб)
window.navigateToEnd = function() {
    if (!data || data.length === 0) {
        addLog('Нет данных для навигации');
        return;
    }
    const ts = chartMain.timeScale();
    const visibleRange = ts.getVisibleLogicalRange();
    if (!visibleRange) {
        addLog('Переход к концу невозможен: видимый диапазон не определён');
        return;
    }
    // Вычислить длину видимого диапазона в логических единицах
    const length = visibleRange.to - visibleRange.from;
    // Установить новый диапазон с той же длиной, но заканчивающийся последней свечой
    const newTo = data.length - 1;
    const newFrom = Math.max(0, newTo - length);
    ts.setVisibleLogicalRange({ from: newFrom, to: newTo });
    addLog('Переход к концу графика');
};

// applyAllSettings is provided by strategy-editor.js.



// =============================================================================
// Обработчики UI при загрузке
window.addEventListener('DOMContentLoaded', () => {
    // Обработка кликов для TF dropdown
    const tfDropdown = document.querySelector('#tf-btn + .dropdown');
    if (tfDropdown) {
        const items = tfDropdown.querySelectorAll('.ind-row:not(.header)');
        items.forEach(item => {
            item.addEventListener('click', () => {
                const value = item.getAttribute('data-value');
                if (value) {
                    window.setTimeframe(value);
                    // Закрыть dropdown
                    const menuItem = item.closest('.menu-item');
                    if (menuItem) menuItem.classList.remove('open');
                }
            });
        });
        // Заголовок TF не кликабелен
        const header = tfDropdown.querySelector('.ind-row.header');
        if (header) {
            header.style.pointerEvents = 'none';
            header.style.cursor = 'default';
        }
    } else {
        addLog('TF dropdown не найден');
    }

    // Обработка кликов для Range dropdown (если нужно, но уже есть в index.html через onclick)
    // Проверим, что заголовок Range также не кликабелен
    const rangeDropdown = document.querySelector('#range-btn + .dropdown');
    if (rangeDropdown) {
        const header = rangeDropdown.querySelector('.ind-row.header');
        if (header) {
            header.style.pointerEvents = 'none';
            header.style.cursor = 'default';
        }
    }
});