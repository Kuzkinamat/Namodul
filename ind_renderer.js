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
        wr.innerHTML = '<div class="v-line"></div><div id="chart-' + id + '" class="chart-container"></div>';
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

    function renderSMA(data, params, chartMain, mainSeriesRefs, LightweightCharts) {
        removeMainSeries('SMA', chartMain, mainSeriesRefs);
        mainSeriesRefs.SMA = [];
        const s = chartMain.addSeries(LightweightCharts.LineSeries, {
            color: '#ff00a6',
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false
        });
        const sma = window.calcSMA(data, params.smaPeriod);
        s.setData(sma.map(point => toLinePoint(point.time, point.value)));
        mainSeriesRefs.SMA.push(s);
    }

    function renderBB(data, params, chartMain, mainSeriesRefs, LightweightCharts) {
        removeMainSeries('BB', chartMain, mainSeriesRefs);
        mainSeriesRefs.BB = [];
        const bb = window.calcBB(data, params.bbPeriod, params.bbStdDev);
        [
            { k: 't', c: 'rgba(38,166,154,0.3)' },
            { k: 'm', c: 'rgba(33,150,243,0.5)' },
            { k: 'b', c: 'rgba(38,166,154,0.3)' }
        ].forEach(o => {
            const s = chartMain.addSeries(LightweightCharts.LineSeries, {
                color: o.c,
                lineWidth: 1,
                lastValueVisible: false,
                priceLineVisible: false
            });
            const keyMap = { t: 'upper', m: 'middle', b: 'lower' };
            s.setData(bb.map(v => toLinePoint(v.time, v[keyMap[o.k]])));
            mainSeriesRefs.BB.push(s);
        });
    }

    function renderStochastic(data, params, pane, LightweightCharts, addLog) {
        const stochasticData = window.calcStochastic(
            data,
            params.stochasticK,
            params.stochasticD,
            params.stochasticSlowing
        );

        const nonNullK = stochasticData.filter(d => d.k !== null).length;
        const nonNullD = stochasticData.filter(d => d.d !== null).length;
        
        if (nonNullK > 0) {
            const firstK = stochasticData.find(d => d.k !== null);
            const lastK = stochasticData.slice().reverse().find(d => d.k !== null);
        }

        const kLine = pane.chart.addSeries(LightweightCharts.LineSeries, {
            color: '#ff00a6',
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false
        });
        kLine.setData(stochasticData.map(d => ({ time: d.time, value: d.k })));
        pane.series.push(kLine);

        const dLine = pane.chart.addSeries(LightweightCharts.LineSeries, {
            color: '#2196f3',
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false
        });
        dLine.setData(stochasticData.map(d => ({ time: d.time, value: d.d })));
        pane.series.push(dLine);
    }

    function renderMACD(data, params, pane, LightweightCharts) {
        const h = pane.chart.addSeries(LightweightCharts.HistogramSeries, {
            lastValueVisible: false,
            priceLineVisible: false
        });
        const l1 = pane.chart.addSeries(LightweightCharts.LineSeries, {
            color: '#2196f3',
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false
        });
        const l2 = pane.chart.addSeries(LightweightCharts.LineSeries, {
            color: '#ff9800',
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false
        });

        const macdData = window.calcMACD(data, params.macdFast, params.macdSlow, params.macdSignal);
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
        const atrData = useAtrSettings
            ? window.calcATR(
                data,
                Math.max(2, Number(params.atrPeriod)),
                Math.max(1, Number(params.atrSmoothPeriod))
            )
            : window.calcATR(data);
        if (!Array.isArray(atrData) || atrData.length !== data.length) {
            if (addLog) addLog('ATR: invalid indicator data');
            return;
        }

        // Always display ATR as percentage: ATR / Close * 100.
        const atrView = atrData.map((v, i) => {
            const close = data[i] && Number.isFinite(data[i].close) ? data[i].close : null;
            return Number.isFinite(v) && Number.isFinite(close) && close > 0 ? (v / close) * 100 : null;
        });

        const finiteAtr = atrView.filter(v => Number.isFinite(v));
        const maxAtr = finiteAtr.length ? Math.max(...finiteAtr) : 0;
        let precision = 2;
        if (maxAtr < 0.001) precision = 4;
        else if (maxAtr < 0.01) precision = 3;
        else if (maxAtr < 0.1) precision = 3;
        const minMove = Math.pow(10, -precision);

        // Render ATR as a line in a separate pane, similar to oscillators.
        const line = pane.chart.addSeries(LightweightCharts.LineSeries, {
            color: '#8ec5ff',
            lineWidth: 2,
            lastValueVisible: false,
            priceLineVisible: false,
            priceFormat: {
                type: 'price',
                precision,
                minMove
            }
        });
        line.setData(data.map((c, i) => ({ time: c.time, value: atrView[i] })));
        pane.series.push(line);
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
            LightweightCharts
        } = ctx;

        if (!isChecked) {
            removeMainSeries(id, chartMain, mainSeriesRefs);
            removePane(id, activePanes);
            onResize();
            return true;
        }

        if (!data.length) {
            return true;
        }

        if (id === 'SMA') {
            renderSMA(data, params, chartMain, mainSeriesRefs, LightweightCharts);
            return true;
        }

        if (id === 'BB') {
            renderBB(data, params, chartMain, mainSeriesRefs, LightweightCharts);
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

    return {
        toggleIndicator
    };
})();
