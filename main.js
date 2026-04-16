// main.js - Main application logic

const SCALE_WIDTH = 80;
let data = [];
window.data = data; // expose globally
let MARKER_TIMESTAMPS = [];
window.MARKER_TIMESTAMPS = MARKER_TIMESTAMPS; // экспорт для strategy.js
let currentRange = '3M', currentTimeframe = '5m', currentSource = 'none', currentPair = '', curM = 0, isSyncing = false, isApplyingProgrammaticRange = false;
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

function getInitialViewportCandleCount(timeframe) {
    const timeframeMinutes = window.DataUtils?.TIMEFRAME_MINUTES?.[timeframe];
    if (!Number.isFinite(timeframeMinutes) || timeframeMinutes <= 0) {
        return 288;
    }
    return Math.max(2, Math.ceil((24 * 60) / timeframeMinutes));
}

function applyInitialViewport() {
    if (!Array.isArray(data) || data.length === 0) {
        return;
    }

    const visibleCandles = Math.min(data.length, getInitialViewportCandleCount(currentTimeframe));
    const to = Math.max(0, data.length - 1);
    const from = Math.max(0, to - visibleCandles + 1);
    chartMain.timeScale().setVisibleLogicalRange({ from, to });
}

function applyLogicalRangeSilently(chart, range) {
    if (!chart || !range) {
        return;
    }

    isApplyingProgrammaticRange = true;
    try {
        chart.timeScale().setVisibleLogicalRange(range);
    } finally {
        isApplyingProgrammaticRange = false;
    }
}

function captureViewportState() {
    const logicalRange = chartMain.timeScale().getVisibleLogicalRange();
    if (!logicalRange) {
        return null;
    }

    return {
        logicalRange: {
            from: logicalRange.from,
            to: logicalRange.to
        }
    };
}

function restoreViewportState(state) {
    const range = state && state.logicalRange;
    if (!range) {
        return;
    }

    applyLogicalRangeSilently(chartMain, range);
    syncAll(chartMain);
}

window.captureViewportState = captureViewportState;
window.restoreViewportState = restoreViewportState;

function setIndicatorCheckboxState(id, isChecked) {
    const checkbox = document.querySelector('#indicator-menu input[data-id="' + id + '"]');
    if (checkbox) {
        checkbox.checked = isChecked === true;
    }
}

function initializeStartupPanels() {
    setIndicatorCheckboxState('Worktime', true);
    if (typeof window.setWorktimeOverlayVisible === 'function') {
        window.setWorktimeOverlayVisible(true);
    }
}



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

const mainPane = document.getElementById('main-pane');
const chartMainContainer = document.getElementById('chart-main');
const mainSessionBackground = document.getElementById('main-session-background');
const mainSessionTrack = document.getElementById('main-session-track');
const mainSessionScale = document.getElementById('main-session-scale');

function getWorktimeStripHeight() {
    const raw = window.getComputedStyle(document.documentElement).getPropertyValue('--worktime-strip-height');
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 28;
}

const SESSION_BACKGROUND_COLORS = Object.freeze({
    closed: '#c94b4b',
    asia: '#3d7eff',
    europe: '#26a96c',
    us: '#26a96c'
});

let mainSessionBackgroundFrame = null;
let isWorktimeOverlayEnabled = false;

function getMainBackgroundContext() {
    if (!mainSessionBackground || !mainSessionTrack) {
        return null;
    }

    const width = mainPane ? mainPane.clientWidth : 0;
    const height = getWorktimeStripHeight();
    const scaleWidth = Math.max(0, Math.min(SCALE_WIDTH, width));
    const trackWidth = Math.max(0, width - scaleWidth);
    if (!width || !height || !trackWidth) {
        return null;
    }

    mainSessionBackground.style.width = width + 'px';
    mainSessionBackground.style.height = height + 'px';
    if (mainSessionScale) {
        mainSessionScale.style.width = scaleWidth + 'px';
        mainSessionScale.style.flexBasis = scaleWidth + 'px';
    }
    return { width, height, trackWidth };
}

function getSessionKey(candle) {
    if (!candle) {
        return 'closed';
    }
    const params = window.Strategy?.params || window.StrategyCore?.getDefaultParams?.() || {};
    const sessionInfo = window.StrategyCore && typeof window.StrategyCore.getSessionInfo === 'function'
        ? window.StrategyCore.getSessionInfo(candle.time, params)
        : candle;
    if (!sessionInfo || sessionInfo.isTradingHour === false) {
        return 'closed';
    }
    return sessionInfo.sessionKey || 'closed';
}

function drawMainSessionBackground() {
    const surface = getMainBackgroundContext();
    if (!surface) {
        return;
    }

    const { trackWidth } = surface;
    if (!isWorktimeOverlayEnabled) {
        mainSessionTrack.replaceChildren();
        mainSessionBackground.style.display = 'none';
        return;
    }

    mainSessionBackground.style.display = 'flex';

    if (!Array.isArray(data) || data.length === 0) {
        mainSessionTrack.replaceChildren();
        return;
    }

    const ts = chartMain.timeScale();
    const visibleRange = ts.getVisibleLogicalRange();
    if (!visibleRange) {
        mainSessionTrack.replaceChildren();
        return;
    }

    const visibleFrom = Math.max(0, visibleRange.from);
    const visibleTo = Math.min(data.length - 1, visibleRange.to);
    if (!Number.isFinite(visibleFrom) || !Number.isFinite(visibleTo) || visibleFrom >= visibleTo) {
        mainSessionTrack.replaceChildren();
        return;
    }

    const from = Math.max(0, Math.floor(visibleFrom));
    const to = Math.min(data.length - 1, Math.ceil(visibleTo));
    if (from > to) {
        mainSessionTrack.replaceChildren();
        return;
    }

    const visibleSpan = Math.max(1, visibleTo - visibleFrom);

    let segmentStart = from;
    let segmentKey = getSessionKey(data[from]);
    const fragment = document.createDocumentFragment();

    function flushSegment(endIndexExclusive) {
        if (segmentStart >= endIndexExclusive) {
            return;
        }
        const leftRatio = Math.max(0, Math.min(1, (segmentStart - visibleFrom) / visibleSpan));
        const rightRatio = Math.max(0, Math.min(1, (endIndexExclusive - visibleFrom) / visibleSpan));
        if (!Number.isFinite(leftRatio) || !Number.isFinite(rightRatio) || rightRatio <= leftRatio) {
            return;
        }
        const color = SESSION_BACKGROUND_COLORS[segmentKey] || SESSION_BACKGROUND_COLORS.closed;
        const segment = document.createElement('div');
        segment.className = 'worktime-segment';
        segment.style.left = (leftRatio * 100).toFixed(3) + '%';
        segment.style.width = ((rightRatio - leftRatio) * 100).toFixed(3) + '%';
        segment.style.background = color;
        fragment.appendChild(segment);
    }

    for (let index = from + 1; index <= to; index++) {
        const candle = data[index];
        const key = getSessionKey(candle);
        if (key !== segmentKey) {
            flushSegment(index);
            segmentStart = index;
            segmentKey = key;
        }
    }
    flushSegment(to + 1);
    mainSessionTrack.replaceChildren(fragment);
}

function scheduleMainSessionBackgroundDraw() {
    if (mainSessionBackgroundFrame !== null) {
        return;
    }
    mainSessionBackgroundFrame = window.requestAnimationFrame(() => {
        mainSessionBackgroundFrame = null;
        drawMainSessionBackground();
    });
}

window.updateMainSessionBackground = scheduleMainSessionBackgroundDraw;
window.setWorktimeOverlayVisible = function(isVisible) {
    isWorktimeOverlayEnabled = isVisible === true;
    if (isWorktimeOverlayEnabled) {
        mainSessionBackground.style.display = 'flex';
    } else {
        if (mainSessionTrack) {
            mainSessionTrack.replaceChildren();
        }
        mainSessionBackground.style.display = 'none';
    }

    window.requestAnimationFrame(() => {
        if (typeof window.onresize === 'function') {
            window.onresize();
        }
    });

    scheduleMainSessionBackgroundDraw();
};

window.onresize = () => { 
    const container = chartMainContainer;
    if (!container) return;
    chartMain.resize(container.clientWidth, container.clientHeight); 
    Object.entries(activePanes).forEach(([id, p]) => {
        const wrapper = document.getElementById('wrapper-' + id);
        const paneHeight = wrapper ? wrapper.clientHeight : 130;
        p.chart.resize(container.clientWidth, paneHeight);
    });
    scheduleMainSessionBackgroundDraw();
};

let hasAutoEnabledBalanceOnFirstOpen = false;

function getBalancePaneData() {
    if (!data.length) {
        addLog('No data available for balance calculation');
        return null;
    }

    const winPayout = window.Strategy?.params?.winPayout ?? 0.8;
    const balanceData = window.Strategy.calculatePnL(data, window.lastSignals || [], 100, 1, winPayout, { logSummary: false });
    if (!balanceData || balanceData.length === 0) {
        addLog('Failed to calculate balance');
        return null;
    }

    return balanceData;
}

function ensureBalancePane() {
    if (activePanes.Balance) {
        return activePanes.Balance;
    }

    const wr = document.createElement('div');
    wr.id = 'wrapper-Balance';
    wr.className = 'pane-wrapper sub-pane';
    wr.style.height = '65px';
    wr.innerHTML = `<div class="v-line"></div><div id="chart-Balance" class="chart-container"></div>`;
    document.getElementById('panels-container').appendChild(wr);

    const chart = LightweightCharts.createChart(document.getElementById('chart-Balance'), {
        layout: { background: { color: '#131722' }, textColor: '#d1d4dc' },
        rightPriceScale: { borderColor: '#363c4e', minimumWidth: 80, autoScale: true },
        grid: { vertLines: { visible: false }, horzLines: { color: '#242733' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Hidden },
        timeScale: { visible: false }
    });

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => syncAll(chart));
    activePanes.Balance = { chart, series: [] };
    return activePanes.Balance;
}

function ensureSignalsPane() {
    if (activePanes.Signals) {
        return activePanes.Signals;
    }

    const wr = document.createElement('div');
    wr.id = 'wrapper-Signals';
    wr.className = 'pane-wrapper sub-pane';
    const signalPaneHeight = 100;
    wr.style.height = signalPaneHeight + 'px';
    wr.innerHTML = `<div class="v-line"></div><div id="chart-label-Signals" class="pane-label"></div><div id="chart-Signals" class="chart-container"></div>`;
    
    // Insert signals pane right after main-pane
    const mainPane = document.getElementById('main-pane');
    const panelsContainer = document.getElementById('panels-container');
    if (mainPane && panelsContainer) {
        mainPane.parentNode.insertBefore(wr, mainPane.nextSibling);
    } else {
        panelsContainer.appendChild(wr);
    }

    const chart = LightweightCharts.createChart(document.getElementById('chart-Signals'), {
        layout: { background: { color: '#131722' }, textColor: '#d1d4dc' },
        rightPriceScale: { borderColor: '#363c4e', minimumWidth: 80, autoScale: true },
        grid: { vertLines: { visible: false }, horzLines: { color: '#242733' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Hidden },
        timeScale: { visible: false }
    });

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => syncAll(chart));
    activePanes.Signals = { chart, series: [] };
    return activePanes.Signals;
}

function renderSignalsPane(data, signalPaneData) {
    const pane = ensureSignalsPane();

    // Clear existing series
    pane.series.forEach(series => pane.chart.removeSeries(series));
    pane.series = [];

    if (!data || !signalPaneData || !signalPaneData.length) {
        return;
    }

    const bbColor     = 'rgba(38,166,154,0.9)';      // BB-границы флета — teal
    const macdColor   = '#2196f3';                    // MACD — синий
    const signalColor = 'rgba(200,200,200,0.85)';     // результирующий — светло-серый
    const trendColor  = 'rgba(255,152,0,0.85)';       // SMA тренд — оранжевый

    // BB верхняя граница флета (+value, тeal пунктир)
    const topBand = pane.chart.addSeries(LightweightCharts.LineSeries, {
        color: bbColor,
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: -1, maxValue: 1 } })
    });
    // value=1 во флете → рисуем на ±0.5 (масштабируем *0.5)
    topBand.setData(signalPaneData.map(p => ({ time: p.time, value: p.value * 0.5 })));
    pane.series.push(topBand);

    // BB нижняя граница флета (-value*0.5, зеркальная)
    const botBand = pane.chart.addSeries(LightweightCharts.LineSeries, {
        color: bbColor,
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: -1, maxValue: 1 } })
    });
    botBand.setData(signalPaneData.map(p => ({ time: p.time, value: -p.value * 0.5 })));
    pane.series.push(botBand);

    // MACD нормализованный (синий)
    const macdSeries = pane.chart.addSeries(LightweightCharts.LineSeries, {
        color: macdColor,
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: -1, maxValue: 1 } })
    });
    macdSeries.setData(signalPaneData.map(p => ({ time: p.time, value: typeof p.value2 === 'number' ? p.value2 : 0 })));
    pane.series.push(macdSeries);

    // Тренд SMA200 (оранжевый)
    const trendSeries = pane.chart.addSeries(LightweightCharts.LineSeries, {
        color: trendColor,
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: -1, maxValue: 1 } })
    });
    trendSeries.setData(signalPaneData.map(p => ({ time: p.time, value: typeof p.trend === 'number' ? p.trend * 0.5 : 0 })));
    pane.series.push(trendSeries);

    // Результирующий Signal (светло-серый)
    const compositeSeries = pane.chart.addSeries(LightweightCharts.LineSeries, {
        color: signalColor,
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: -1, maxValue: 1 } })
    });
    compositeSeries.setData(signalPaneData.map(p => ({ time: p.time, value: typeof p.composite === 'number' ? p.composite : 0 })));
    pane.series.push(compositeSeries);

    const labelEl = document.getElementById('chart-label-Signals');
    if (labelEl) labelEl.innerHTML = '<span style="color:#5d606b">Signals</span>&nbsp;<span style="color:rgba(38,166,154,0.9)">Flat</span>&nbsp;<span style="color:#2196f3">Momentum</span>&nbsp;<span style="color:rgba(255,152,0,0.85)">Trend</span>&nbsp;<span style="color:rgba(200,200,200,0.85)">Result</span>';

    // Sync time scale with main chart
    const mainTimeScale = window.chartMain.timeScale();
    applyLogicalRangeSilently(pane.chart, mainTimeScale.getVisibleLogicalRange());
}

function renderBalancePane(balancePaneData) {
    const pane = ensureBalancePane();

    pane.series.forEach(series => pane.chart.removeSeries(series));
    pane.series = [];

    const balanceSeries = pane.chart.addSeries(LightweightCharts.LineSeries, {
        color: '#00ff00',
        lineWidth: 2,
        lastValueVisible: false,
        priceLineVisible: false
    });
    balanceSeries.setData(balancePaneData);
    pane.series.push(balanceSeries);

    const mainRange = chartMain.timeScale().getVisibleLogicalRange();
    applyLogicalRangeSilently(pane.chart, mainRange);
    window.onresize();
    syncAll(chartMain);
}

async function autoRunSelectedStrategy(options = {}) {
    if (!Array.isArray(window.data) || window.data.length === 0) {
        if (options.logNoData !== false) {
            addLog('No autorun: no data available');
        }
        return;
    }

    if (window.StrategyEditor && typeof window.StrategyEditor.ensureInitialStrategyReady === 'function') {
        await window.StrategyEditor.ensureInitialStrategyReady();
    }

    const maxAttempts = 10;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (window.Strategy && typeof window.Strategy.testStrategy === 'function') {
            if (window.StrategyEditor && typeof window.StrategyEditor.syncIndicatorSelectionFromStrategyParams === 'function') {
                window.StrategyEditor.syncIndicatorSelectionFromStrategyParams();
            }

            if (window.StrategyEditor && typeof window.StrategyEditor.hasActiveStrategy === 'function' && !window.StrategyEditor.hasActiveStrategy()) {
                addLog('No autorun: no active strategy selected');
                return;
            }

            window.Strategy.testStrategy();

            if (options.enableBalance === true && !hasAutoEnabledBalanceOnFirstOpen) {
                hasAutoEnabledBalanceOnFirstOpen = true;
                addLog('Start strategy...');
            } else if (options.logSuccess === true) {
                addLog('Restart strategy...');
            }

            return;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    }

    addLog('Not ready');
}

function scheduleAutoRunSelectedStrategy(options = {}) {
    const run = () => {
        autoRunSelectedStrategy(options).catch(err => {
            addLog(`Ошибка автозапуска стратегии: ${err.message}`);
        });
    };

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
                scheduleMainSessionBackgroundDraw();
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
        scheduleMainSessionBackgroundDraw();
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
            data = window.StrategyCore.enrichDataWithTradingHours(data, window.Strategy?.params || {});
        }
        window.data = data;
        candleSeries.setData(data);
        applyInitialViewport();
        scheduleMainSessionBackgroundDraw();
        // Очистить маркеры сигналов
        if (window.Strategy && window.chartMain && window.candleSeries) {
            window.Strategy.clearSignals(window.chartMain, window.candleSeries);
        }
        // Сбросить сигналы
        window.lastSignals = [];
        window.MARKER_TIMESTAMPS.length = 0;
        // Обновить график баланса, если он активен
        if (activePanes.Balance && typeof window.updateBalance === 'function') {
            window.updateBalance();
        }
        document.querySelectorAll('#indicator-menu input[type=\"checkbox\"]').forEach(cb => {
            if(cb.checked) window.toggleIndicator(cb.getAttribute('data-id'), true);
        });
        updateIndicatorValues();

        // Re-apply startup viewport after indicator refresh/sync side effects.
        applyInitialViewport();

        scheduleAutoRunSelectedStrategy({
            enableBalance: !hasAutoEnabledBalanceOnFirstOpen,
            logNoData: false
        });

        addLog(`Loaded ${p}: ${data.length} candles (Range: ${currentRange}, TF: ${currentTimeframe})`);
        updateMainChartLabel();
    }
};

function updateMainChartLabel() {
    const el = document.getElementById('chart-main-label');
    if (!el) return;
    const params = { ...(window.StrategyCore?.getDefaultParams?.() || {}), ...(window.Strategy?.params || {}) };
    const parts = [];
    if (currentPair) parts.push(currentPair);
    if (currentTimeframe) parts.push(currentTimeframe);
    if (params.useBB !== false) parts.push('BB(' + (params.bbPeriod || 20) + ', ' + (params.bbStdDev || 2) + ')');
    el.textContent = parts.join('  ');
}

window.updatePaneLabels = function() {
    updateMainChartLabel();
    const params = { ...(window.StrategyCore?.getDefaultParams?.() || {}), ...(window.Strategy?.params || {}) };
    if (window.IndicatorRenderers && typeof window.IndicatorRenderers.setPaneLabel === 'function') {
        if (activePanes.Stochastic) {
            const k = params.stochasticK || 14;
            const d = params.stochasticD || 3;
            const sl = params.stochasticSlowing || 3;
            window.IndicatorRenderers.setPaneLabel('Stochastic', 'Stochastic  K=' + k + '  D=' + d + '  slowing=' + sl);
        }
        if (activePanes.MACD) {
            window.IndicatorRenderers.setPaneLabel('MACD', 'MACD  fast=' + (params.macdFast || 12) + '  slow=' + (params.macdSlow || 26) + '  signal=' + (params.macdSignal || 9));
        }
        if (activePanes.ATR) {
            window.IndicatorRenderers.setPaneLabel('ATR', 'ATR  fast=' + (params.atrFastPeriod || params.atrPeriod || 14) + '  slow=' + (params.atrSlowPeriod || params.atrSmoothPeriod || 28));
        }
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
    const bbUpper = indicators.bb[idx]?.u;
    const bbMiddle = indicators.bb[idx]?.m;
    const bbLower = indicators.bb[idx]?.l;
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
    if (isSyncing || isApplyingProgrammaticRange) return;
    isSyncing = true;
    const range = source.timeScale().getVisibleLogicalRange();
    if (range) {
        [chartMain, ...Object.values(activePanes).map(p => p.chart)].forEach(c => {
            if (c && c !== source) c.timeScale().setVisibleLogicalRange(range);
        });
    }
    updateIndicatorValues();
    scheduleMainSessionBackgroundDraw();
    isSyncing = false;
}

chartMain.timeScale().subscribeVisibleLogicalRangeChange(() => syncAll(chartMain));

// Делегирует переключение/отрисовку индикаторов в IndicatorRenderers.
// main.js сохраняет роль оркестратора и передаёт только контекст (данные, параметры, графики, callbacks).
window.toggleIndicator = function(id, isChecked) {
    const viewportState = captureViewportState();
    const coreDefaults = window.StrategyCore && typeof window.StrategyCore.getDefaultParams === 'function'
        ? window.StrategyCore.getDefaultParams()
        : {};
    const params = { ...coreDefaults, ...(window.Strategy?.params || {}) };

    if (window.IndicatorRenderers && typeof window.IndicatorRenderers.toggleIndicator === 'function') {
        const handled = window.IndicatorRenderers.toggleIndicator({
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
            LightweightCharts,
            setWorktimeOverlayVisible: window.setWorktimeOverlayVisible
        });
        restoreViewportState(viewportState);
        return handled;
    }

    addLog('IndicatorRenderers не инициализирован');
};


// Обновить график баланса (если активен) на основе текущих сигналов
window.updateBalance = function() {
    if (!activePanes.Balance) {
        // График баланса не активен
        return;
    }

    const balancePaneData = getBalancePaneData();
    if (!balancePaneData) {
        return;
    }

    renderBalancePane(balancePaneData);
};

// Export signals pane renderer to global scope
window.renderSignalsPane = renderSignalsPane;

// ── Mini balance overview in topbar ─────────────────────────────────
(function initMiniBalance() {
    let miniBalanceData = null; // cached [{time, value}, ...]

    function drawMiniBalance() {
        const canvas = document.getElementById('mini-balance-canvas');
        if (!canvas) return;
        const wrap = canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        if (!miniBalanceData || miniBalanceData.length < 2) return;

        const vals = miniBalanceData.map(d => d.value);
        const minV = Math.min(...vals);
        const maxV = Math.max(...vals);
        const range = maxV - minV || 1;
        const pad = 2;

        ctx.beginPath();
        for (let i = 0; i < miniBalanceData.length; i++) {
            const x = (i / (miniBalanceData.length - 1)) * w;
            const y = pad + (1 - (miniBalanceData[i].value - minV) / range) * (h - pad * 2);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        const lastVal = vals[vals.length - 1];
        const firstVal = vals[0];
        ctx.strokeStyle = lastVal >= firstVal ? '#26a69a' : '#ef5350';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // fill under line
        const lastX = w;
        const baseY = h;
        ctx.lineTo(lastX, baseY);
        ctx.lineTo(0, baseY);
        ctx.closePath();
        ctx.fillStyle = lastVal >= firstVal ? 'rgba(38,166,154,0.10)' : 'rgba(239,83,80,0.10)';
        ctx.fill();
    }

    function updateMiniViewport() {
        const vp = document.getElementById('mini-balance-viewport');
        const wrap = document.getElementById('mini-balance-wrap');
        if (!vp || !wrap || !data.length) { if (vp) vp.style.display = 'none'; return; }
        const ts = window.chartMain && window.chartMain.timeScale();
        if (!ts) return;
        const range = ts.getVisibleLogicalRange();
        if (!range) return;
        const total = data.length;
        const w = wrap.clientWidth;
        const left = Math.max(0, range.from / total) * w;
        const right = Math.min(1, range.to / total) * w;
        vp.style.display = 'block';
        vp.style.left = left + 'px';
        vp.style.width = Math.max(2, right - left) + 'px';
    }

    // Hook into syncAll to update viewport — done via chartMain timeScale listener
    chartMain.timeScale().subscribeVisibleLogicalRangeChange(() => updateMiniViewport());

    // Update mini balance data whenever balance is computed
    const origGetBalancePaneData = getBalancePaneData;
    getBalancePaneData = function() {
        const result = origGetBalancePaneData();
        if (result && result.length) {
            miniBalanceData = result;
            drawMiniBalance();
            requestAnimationFrame(updateMiniViewport);
        }
        return result;
    };

    // Also refresh mini balance on data reload (even without balance pane open)
    const origUpdateBalance = window.updateBalance;
    window.updateBalance = function() {
        origUpdateBalance();
        // Always update mini balance independently of the full balance pane
        try {
            const bd = origGetBalancePaneData();
            if (bd && bd.length) {
                miniBalanceData = bd;
                drawMiniBalance();
                requestAnimationFrame(updateMiniViewport);
            }
        } catch(e) {}
    };

    // Click on mini balance -> scroll charts to that position
    document.addEventListener('DOMContentLoaded', function() {
        const wrap = document.getElementById('mini-balance-wrap');
        if (!wrap) return;

        let isDragging = false;

        function handleNavigation(e) {
            if (!data.length || !window.chartMain) return;
            const rect = wrap.getBoundingClientRect();
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const ratio = x / rect.width;
            const ts = window.chartMain.timeScale();
            const visibleRange = ts.getVisibleLogicalRange();
            if (!visibleRange) return;
            const span = visibleRange.to - visibleRange.from;
            const center = ratio * data.length;
            const newFrom = Math.max(0, Math.min(center - span / 2, data.length - 1 - span));
            ts.setVisibleLogicalRange({ from: newFrom, to: newFrom + span });
        }

        wrap.addEventListener('mousedown', function(e) {
            isDragging = true;
            handleNavigation(e);
            e.preventDefault();
        });
        document.addEventListener('mousemove', function(e) {
            if (isDragging) handleNavigation(e);
        });
        document.addEventListener('mouseup', function() {
            isDragging = false;
        });
    });

    // Expose for external triggers
    window.updateMiniBalance = function() {
        try {
            const bd = origGetBalancePaneData();
            if (bd && bd.length) {
                miniBalanceData = bd;
                drawMiniBalance();
                requestAnimationFrame(updateMiniViewport);
            }
        } catch(e) {}
    };
})();

// Initialize with default values
window.onresize();

// Auto‑load local data if available
(async function init() {
    // Wait a bit for all scripts to load
    await new Promise(resolve => setTimeout(resolve, 100));
    initializeStartupPanels();
    
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

    if (panel.classList.contains('open') && window.StrategyEditor && typeof window.StrategyEditor.ensureSettingsPanelVisible === 'function') {
        window.StrategyEditor.ensureSettingsPanelVisible();
    }
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
