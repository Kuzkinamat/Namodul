// ind_renderer.js
// Rendering/toggle helpers for indicators.

window.IndicatorRenderers = (function() {
    'use strict';

    function toLinePoint(time, value) {
        return Number.isFinite(value) ? { time, value } : { time };
    }

    function removeMainSeries(id, chartMain, mainSeriesRefs) {
        if (!mainSeriesRefs[id]) return;
        mainSeriesRefs[id].forEach(s => chartMain.removeSeries(s));
        delete mainSeriesRefs[id];
    }

    function removePane(id, activePanes) {
        if (!activePanes[id]) return;
        activePanes[id].chart.remove();
        document.getElementById('wrapper-' + id)?.remove();
        delete activePanes[id];
    }

    function ensurePane(id, activePanes, chartOpts, syncAll, LightweightCharts) {
        if (activePanes[id]) {
            return activePanes[id];
        }

        const wr = document.createElement('div');
        wr.id = 'wrapper-' + id;
        wr.className = 'pane-wrapper sub-pane';
        if (id === 'ATR') {
            wr.style.height = '65px';
        }
        wr.innerHTML = '<div class="v-line"></div><div id="chart-label-' + id + '" class="pane-label"></div><div id="chart-' + id + '" class="chart-container"></div>';
        document.getElementById('panels-container').appendChild(wr);

        const c = LightweightCharts.createChart(document.getElementById('chart-' + id), {
            ...chartOpts,
            // Keep same price scale setup as other panes (e.g. MACD) for consistent layout.
            timeScale: {
                ...chartOpts.timeScale,
                visible: false,
                rightOffset: chartOpts.timeScale?.rightOffset ?? 80
            }
        });
        c.timeScale().subscribeVisibleLogicalRangeChange(() => syncAll(c));
        activePanes[id] = { chart: c, series: [] };
        return activePanes[id];
    }

    function renderBB(data, params, chartMain, mainSeriesRefs, LightweightCharts) {
        removeMainSeries('BB', chartMain, mainSeriesRefs);
        mainSeriesRefs.BB = [];
        const bbColor = 'rgba(38,166,154,0.3)';
        const bbMidColor = 'rgba(33,150,243,0.5)';
        const bbLabelEl = document.getElementById('chart-main-label');
        if (bbLabelEl) bbLabelEl.innerHTML = '<span style="color:' + bbColor + '">BB &nbsp;period=' + params.bbPeriod + '&nbsp; mid&nbsp; stdDev=' + params.bbStdDev + '</span>';
        const bb = window.calcBB(data, params.bbPeriod, params.bbStdDev);
        [
            { k: 't', c: bbColor },
            { k: 'm', c: bbMidColor },
            { k: 'b', c: bbColor }
        ].forEach(o => {
            const s = chartMain.addSeries(LightweightCharts.LineSeries, {
                color: o.c,
                lineWidth: 1,
                lastValueVisible: false,
                priceLineVisible: false
            });
            const keyMap = { t: 'u', m: 'm', b: 'l' };
            s.setData(bb.map(v => toLinePoint(v.time, v[keyMap[o.k]])));
            mainSeriesRefs.BB.push(s);
        });
    }

    function renderStochastic(data, params, pane, LightweightCharts, addLog) {
        const colorK = '#ff00a6';
        const colorD = '#2196f3';
        const labelEl = document.getElementById('chart-label-Stochastic');
        if (labelEl) labelEl.innerHTML = 'Stochastic &nbsp;<span style="color:' + colorK + '">K=' + params.stochasticK + '</span>&nbsp; <span style="color:' + colorD + '">D=' + params.stochasticD + '</span>&nbsp; slowing=' + params.stochasticSlowing;
        const k = params.stochasticK;
        const d = params.stochasticD;
        const sl = params.stochasticSlowing;
        const stochasticData = window.calcStochastic(data, k, d, sl);

        const kLine = pane.chart.addSeries(LightweightCharts.LineSeries, {
            color: colorK,
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false
        });
        kLine.setData(stochasticData.map(d => ({ time: d.time, value: d.k })));
        pane.series.push(kLine);

        const dLine = pane.chart.addSeries(LightweightCharts.LineSeries, {
            color: colorD,
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false
        });
        dLine.setData(stochasticData.map(d => ({ time: d.time, value: d.d })));
        pane.series.push(dLine);
    }

    function renderMACD(data, params, pane, LightweightCharts) {
        const colorMACD = '#2196f3';
        const colorSignal = '#ff9800';
        const labelEl = document.getElementById('chart-label-MACD');
        if (labelEl) labelEl.innerHTML = '<span style="color:' + colorMACD + '">MACD&nbsp; fast=' + params.macdFast + '&nbsp; slow=' + params.macdSlow + '&nbsp; signal=' + params.macdSignal + '</span>';
        const fast = params.macdFast;
        const slow = params.macdSlow;
        const signal = params.macdSignal;
        const h = pane.chart.addSeries(LightweightCharts.HistogramSeries, {
            lastValueVisible: false,
            priceLineVisible: false
        });
        const l1 = pane.chart.addSeries(LightweightCharts.LineSeries, {
            color: colorMACD,
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false
        });
        const l2 = pane.chart.addSeries(LightweightCharts.LineSeries, {
            color: colorSignal,
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false
        });

        const macdData = window.calcMACD(data, fast, slow, signal);
        h.setData(macdData.map(item => ({
            time: item.time,
            value: item.histogram,
            color: item.histogramColor
        })));
        l1.setData(macdData.map(item => ({ time: item.time, value: item.macd })));
        l2.setData(macdData.map(item => ({ time: item.time, value: item.signal })));
        pane.series.push(h, l1, l2);
    }

    function renderATR(data, params, pane, LightweightCharts, addLog) {
        if (typeof window.calcATR !== 'function') {
            if (addLog) addLog('ATR: calcATR function not found');
            return;
        }
        const colorFast = '#ffb347';
        const colorSlow = '#8ec5ff';
        const fastPeriodValue = params.atrFastPeriod || params.atrPeriod;
        const slowPeriodValue = params.atrSlowPeriod || params.atrSmoothPeriod;
        const labelEl = document.getElementById('chart-label-ATR');
        if (labelEl) labelEl.innerHTML = 'ATR &nbsp;<span style="color:' + colorFast + '">fast=' + fastPeriodValue + '</span>&nbsp; <span style="color:' + colorSlow + '">slow=' + slowPeriodValue + '</span>';

        pane.chart.applyOptions({
            rightPriceScale: {
                visible: true,
                borderVisible: true,
                borderColor: '#363c4e',
                ticksVisible: true,
                minimumWidth: 80,
                autoScale: true,
                scaleMargins: { top: 0.1, bottom: 0.1 }
            },
            leftPriceScale: { visible: false },

        });

        const useAtrSettings = !!(params && params.useATR);
        const fastPeriod = useAtrSettings
            ? Math.max(2, Number(params.atrFastPeriod || params.atrPeriod))
            : Math.max(2, Number(params.atrFastPeriod || params.atrPeriod));
        const slowPeriod = useAtrSettings
            ? Math.max(2, Number(params.atrSlowPeriod || params.atrSmoothPeriod))
            : Math.max(2, Number(params.atrSlowPeriod || params.atrSmoothPeriod));

        const atrFastData = window.calcATR(data, fastPeriod, 1);
        const atrSlowData = window.calcATR(data, slowPeriod, 1);
        if (!Array.isArray(atrFastData) || atrFastData.length !== data.length || !Array.isArray(atrSlowData) || atrSlowData.length !== data.length) {
            if (addLog) addLog('ATR: invalid indicator data');
            return;
        }

        // Always display ATR as percentage: ATR / Close * 100.
        const atrFastView = atrFastData.map((v, i) => {
            const close = data[i] && Number.isFinite(data[i].close) ? data[i].close : null;
            return Number.isFinite(v) && Number.isFinite(close) && close > 0 ? (v / close) * 100 : null;
        });
        const atrSlowView = atrSlowData.map((v, i) => {
            const close = data[i] && Number.isFinite(data[i].close) ? data[i].close : null;
            return Number.isFinite(v) && Number.isFinite(close) && close > 0 ? (v / close) * 100 : null;
        });

        let maxAtr = 0;
        for (let index = 0; index < data.length; index++) {
            const fastValue = atrFastView[index];
            const slowValue = atrSlowView[index];
            if (Number.isFinite(fastValue) && fastValue > maxAtr) {
                maxAtr = fastValue;
            }
            if (Number.isFinite(slowValue) && slowValue > maxAtr) {
                maxAtr = slowValue;
            }
        }
        let precision = 2;
        if (maxAtr < 0.001) precision = 4;
        else if (maxAtr < 0.01) precision = 3;
        else if (maxAtr < 0.1) precision = 3;
        const minMove = Math.pow(10, -precision);

        const fastLine = pane.chart.addSeries(LightweightCharts.LineSeries, {
            color: colorFast,
            lineWidth: 2,
            lastValueVisible: false,
            priceLineVisible: false,
            priceFormat: {
                type: 'price',
                precision,
                minMove
            }
        });
        fastLine.setData(data.map((c, i) => ({ time: c.time, value: atrFastView[i] })));

        const slowLine = pane.chart.addSeries(LightweightCharts.LineSeries, {
            color: colorSlow,
            lineWidth: 2,
            lastValueVisible: false,
            priceLineVisible: false,
            priceFormat: {
                type: 'price',
                precision,
                minMove
            }
        });
        slowLine.setData(data.map((c, i) => ({ time: c.time, value: atrSlowView[i] })));
        pane.series.push(fastLine, slowLine);
    }

    function renderSMA(data, params, chartMain, mainSeriesRefs, LightweightCharts) {
        removeMainSeries('SMA', chartMain, mainSeriesRefs);
        mainSeriesRefs.SMA = [];
        const period = Math.max(2, Number(params.smaPeriod));
        const smaColor = 'rgba(255,152,0,0.8)';
        const smaData = window.calcSMA(data, period);
        const s = chartMain.addSeries(LightweightCharts.LineSeries, {
            color: smaColor,
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false
        });
        s.setData(smaData.map(v => toLinePoint(v.time, v.value)));
        mainSeriesRefs.SMA.push(s);
    }

    function toggleIndicator(ctx) {
        const {
            id,
            isChecked,
            data,
            params,
            chartMain,
            chartOpts,
            mainSeriesRefs,
            activePanes,
            syncAll,
            onResize,
            addLog,
            LightweightCharts,
            setWorktimeOverlayVisible
        } = ctx;

        if (id === 'Worktime') {
            if (typeof setWorktimeOverlayVisible === 'function') {
                setWorktimeOverlayVisible(isChecked);
            }
            return true;
        }

        if (!isChecked) {
            removeMainSeries(id, chartMain, mainSeriesRefs);
            removePane(id, activePanes);
            if (id === 'BB') {
                const bbLabelEl = document.getElementById('chart-main-label');
                if (bbLabelEl) bbLabelEl.innerHTML = '';
            }
            onResize();
            return true;
        }

        if (!data.length) {
            return true;
        }

        if (id === 'BB') {
            renderBB(data, params, chartMain, mainSeriesRefs, LightweightCharts);
            return true;
        }

        if (id === 'SMA') {
            renderSMA(data, params, chartMain, mainSeriesRefs, LightweightCharts);
            return true;
        }

        addLog('Main data length: ' + data.length);
        addLog('First candle time: ' + new Date(data[0].time * 1000).toISOString());
        addLog('Last candle time: ' + new Date(data[data.length - 1].time * 1000).toISOString());

        const pane = ensurePane(id, activePanes, chartOpts, syncAll, LightweightCharts);
        pane.series.forEach(s => pane.chart.removeSeries(s));
        pane.series = [];

        if (id === 'Stochastic') {
            renderStochastic(data, params, pane, LightweightCharts, addLog);
        }
        if (id === 'MACD') {
            renderMACD(data, params, pane, LightweightCharts);
        }
        if (id === 'ATR') {
            renderATR(data, params, pane, LightweightCharts, addLog);
        }
        onResize();
        syncAll(chartMain);
        return true;
    }

    function setPaneLabel(id, text) {
        const el = document.getElementById('chart-label-' + id);
        if (el) el.textContent = text;
    }

    return {
        toggleIndicator,
        setPaneLabel
    };
})();
