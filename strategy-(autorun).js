// strategy-(autorun).js
// Unified strategy definition using new naming system: c(), i.*, t()

window.StrategyDefinition = (function() {
    'use strict';

    function buildLogicEvaluator(source) {
        const logicBody = String(source || '').trim();
        if (!logicBody) {
            return function() {
                return { buy: 0, sell: 0 };
            };
        }

        // Compile once, reuse on every candle
        const compiled = new Function('c', 'i', 't', 's', 'let buy = 0, sell = 0; ' + logicBody + ' return { buy, sell };');

        return function(ctx) {
            if (!ctx) return { buy: 0, sell: 0 };
            try {
                const c = typeof ctx.c === 'function' ? ctx.c : null;
                const i = ctx.i || {};
                const t = typeof ctx.t === 'function' ? ctx.t : null;
                const s = ctx.s || {};
                if (!c || !i) return { buy: 0, sell: 0 };

                const result = compiled.call(null, c, i, t, s);
                return {
                    buy: Number.isFinite(result.buy) ? result.buy : 0,
                    sell: Number.isFinite(result.sell) ? result.sell : 0
                };
            } catch (err) {
                console.error('Logic evaluation error:', err.message);
                return { buy: 0, sell: 0 };
            }
        };
    }

    const indicatorSettings = Object.freeze({
        useWorktime: true,
        
        useBB: true,
        bbPeriod: 50,
        bbStdDev: 2,

        useMACD: true,

        useSMA: false,
        smaPeriod: 100,

        useATR: false,
        atrFastPeriod: 14,
        atrSlowPeriod: 56,
        
        useStochastic: false,
        stochasticK: 14,
        stochasticD: 3,
        stochasticSlowing: 3
    });

    const moneyManagementSettings = Object.freeze({
        expirationMinutes: 15,
        winPayout: 0.8
    });

    const hoursSettings = Object.freeze({
        filterTradingHours: true,
        tradingOpenDayUtc: 1,
        tradingOpenHourUtc: 0,
        tradingOpenMinuteUtc: 0,
        tradingCloseDayUtc: 5,
        tradingCloseHourUtc: 22,
        tradingCloseMinuteUtc: 0,
        asiaSessionStartHourUtc: 0,
        europeSessionStartHourUtc: 7,
        usSessionStartHourUtc: 13
    });

    const logicSource = `
// Вход по сигналам из Signals:
// s.phase = Фаза рынка (0..1, флэт/движение)
// s.entry = Точка входа (-1..+1, краткосрочный сигнал)
// s.trend = Долгосрочный тренд (-1..+1)
// s.valid = Валидный сигнал (составляющий)
// s.result = Результирующий сигнал (для входа)

// Округление до 0.1
function roundTo01(val) {
    return Math.round(val * 10) / 10;
}

// Вход по величине результирующего сигнала
if (s.result >= 1) {
    buy = roundTo01(s.result);
}
if (s.result <= -1) {
    sell = roundTo01(Math.abs(s.result));
}
`;

    const evaluateLogic = buildLogicEvaluator(logicSource);

    function buildSignalsEvaluator(source) {
        const logicBody = String(source || '').trim();
        if (!logicBody) {
            return function() { return { phase: 0, entry: 0, trend: 0, valid: 0, result: 0 }; };
        }
        // Компилируем код сигналов
        const compiled = new Function('c', 'i', 't', logicBody + ' return { phase: phaseSignal, entry: entrySignal, trend: trendSignal, valid: validSignal, result: resultSignal };');
        return function(ctx) {
            if (!ctx) return { phase: 0, entry: 0, trend: 0, valid: 0, result: 0 };
            try {
                const c = typeof ctx.c === 'function' ? ctx.c : null;
                const i = ctx.i || {};
                const t = typeof ctx.t === 'function' ? ctx.t : null;
                if (!c || !i) return { phase: 0, entry: 0, trend: 0, valid: 0, result: 0 };
                const result = compiled.call(null, c, i, t);
                return {
                    phase: Number.isFinite(result.phase) ? result.phase : 0,
                    entry: Number.isFinite(result.entry) ? result.entry : 0,
                    trend: Number.isFinite(result.trend) ? result.trend : 0,
                    valid: Number.isFinite(result.valid) ? result.valid : 0,
                    result: Number.isFinite(result.result) ? result.result : 0
                };
            } catch (err) {
                console.error('Signals eval error:', err.message, err.stack);
                return { phase: 0, entry: 0, trend: 0, valid: 0, result: 0 };
            }
        };
    }

    const signalsSource = `
// === НОВЫЕ ИМЕНА СИГНАЛОВ ===
// phaseSignal → s.phase (фаза рынка: 0..1, разрешающий множитель)
//   рассчитывается как ratio между текущей шириной BB и максимальной шириной за окно
//   - узкий диапазон BB (флет/шум) → relBw близко к 0 → phaseSignal близко к 0 (сигналы не усилены)
//   - широкий диапазон BB (тренд) → relBw близко к 1 → phaseSignal близко к 1 (сигналы усилены)
//   дублируется в отрицательную область для визуализации 2 зеркальных линий:
//     - верхняя: +phase * 0.5
//     - нижняя: -phase * 0.5
//   + центральная толстая линия от -1 до +1 для индикации разрешения (0 = закрыто, ±1 = открыто)
// entrySignal → s.entry (точка входа: -1..+1, направленный краткосрочный сигнал)
// trendSignal → s.trend (долгосрочный тренд: -1..+1, направленный)
// validSignal → s.valid (пока не используется в result, но вычисляется)
// resultSignal → s.result = ((entry*wEntry + trend*wTrend + valid*wValid) × phase)

// Инициализация переменных сигналов
let phaseSignal = 0;
let entrySignal = 0;
let trendSignal = 0;
let validSignal = 0;
let resultSignal = 0;

// === Множители для сигналов (только для направленных компонент) ===
const wEntry = 1.0;   // Множитель для точки входа
const wTrend = 1.0;   // Множитель для тренда
const wValid = 1.0;   // Множитель для валидного сигнала

// Проверка доступности функций - если функций нет, переменные останутся 0
if (typeof i.bb === 'function' && typeof i.macd === 'function' && typeof c === 'function') {

// --- Флэт (узкий диапазон BB) ---
// phaseSignal = плавная функция 0..1 (модулятор)
// используется для умножения на направленные сигналы
const bb0 = i.bb(0);
if (bb0 && bb0.m > 0) {
    const bwNorm = (bb0.u - bb0.l) / bb0.m;
    const WINDOW = 200;  // Долгосрочный максимум за 200 свечей
    let maxBw = bwNorm;
    for (let lag = 1; lag < WINDOW; lag++) {
        const b = i.bb(-lag);
        if (b && b.m > 0) {
            const bw = (b.u - b.l) / b.m;
            if (bw > maxBw) maxBw = bw;
        }
    }
    let relBw = maxBw > 0 ? bwNorm / maxBw : 1;
    // Сглаживание relBw: округляем до 0.05 (20 квантов) для плавных переходов без скачков
    relBw = Math.round(relBw * 20) / 20;
    // phaseSignal = relBw напрямую (0..1)
    phaseSignal = relBw;
}

// --- MACD: два сигнала ---
// 1. macdDirection - направление и сила (сама MACD линия, нормализованная)
// 2. macdConvergence - схождение линий (как быстро гистограмма уменьшается)
const mac0 = i.macd(0);
const mac1 = i.macd(-1);
if (mac0 && mac0.histogram !== null && mac0.histogram !== undefined) {
    const MACD_WINDOW = 50;
    
    // --- Направление (нормализуем гистограмму за окно) ---
    let maxAbsHist = Math.abs(mac0.histogram);
    for (let lag = 1; lag < MACD_WINDOW; lag++) {
        const m = i.macd(-lag);
        if (m && m.histogram !== null && m.histogram !== undefined) {
            const absH = Math.abs(m.histogram);
            if (absH > maxAbsHist) maxAbsHist = absH;
        }
    }
    if (maxAbsHist > 0) {
        entrySignal = mac0.histogram / maxAbsHist;
        entrySignal = Math.max(-1, Math.min(1, entrySignal));
    }
}

    // --- Тренд (пока заглушка, настроите позже) ---
    trendSignal = 0;

    // --- Валидный сигнал (пока не используем, но вычисляем для логирования) ---
    validSignal = (entrySignal * wEntry) + (trendSignal * wTrend);

    // --- Результирующий сигнал (три компоненты, модулированы фазой) ---
    // result = ((entry × wEntry) + (trend × wTrend) + (valid × wValid)) × phase
    resultSignal = ((entrySignal * wEntry) + (trendSignal * wTrend) + (validSignal * wValid)) * phaseSignal;
}
`;

    const evaluateSignals = buildSignalsEvaluator(signalsSource);

    const DEFAULT_PARAMS = Object.freeze({
        ...moneyManagementSettings,
        ...hoursSettings,
        ...indicatorSettings
    });

    function getDefaultParams() {
        return { ...DEFAULT_PARAMS };
    }

    function normalizeParams(params) {
        return { ...DEFAULT_PARAMS, ...(params || {}) };
    }

    return {
        meta: Object.freeze({
            id: 'autorun',
            label: 'Autorun'
        }),
        settings: Object.freeze({
            indicators: indicatorSettings,
            moneyManagement: moneyManagementSettings,
            hours: hoursSettings
        }),
        entry: Object.freeze({
            source: logicSource,
            evaluate: evaluateLogic
        }),
        signals: Object.freeze({
            source: signalsSource,
            evaluate: evaluateSignals,
            color: 'rgba(38,166,154,0.9)',      // BB teal — верхняя граница флета
            colorNeg: 'rgba(38,166,154,0.9)'   // BB teal — нижняя граница флета
        }),
        DEFAULT_PARAMS,
        getDefaultParams,
        normalizeParams
    };
})();

window.StrategyParams = (function(definition) {
    'use strict';

    const defaultParams = definition && typeof definition.getDefaultParams === 'function'
        ? Object.freeze(definition.getDefaultParams())
        : Object.freeze({});

    return {
        getDefaultParams: function() {
            return { ...defaultParams };
        },
        normalizeParams: function(params) {
            return definition && typeof definition.normalizeParams === 'function'
                ? definition.normalizeParams(params)
                : { ...defaultParams, ...(params || {}) };
        }
    };
})(window.StrategyDefinition);
