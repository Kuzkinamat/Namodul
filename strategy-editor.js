// strategy-editor.js
// Strategy code editor and setting sync with indicator checkboxes.

(function() {
    'use strict';

    function log(message) {
        if (typeof window.addLog === 'function') {
            window.addLog(message);
        }
    }

    function syncIndicatorSelectionFromStrategyParams() {
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
            const cb = document.querySelector(`#indicator-menu input[data-id="${id}"]`);
            if (cb && cb.checked !== want) {
                cb.checked = want;
            }
            if (typeof window.toggleIndicator === 'function') {
                window.toggleIndicator(id, want);
            }
        });
    }

    function refreshActiveIndicators(options = {}) {
        const includeBalance = options.includeBalance !== false;
        const checkboxes = document.querySelectorAll('#indicator-menu input[type="checkbox"]');
        if (!checkboxes.length) {
            return;
        }

        checkboxes.forEach(cb => {
            if (!cb.checked) {
                return;
            }

            const indicatorId = cb.getAttribute('data-id');
            if (!indicatorId) {
                return;
            }

            if (indicatorId === 'Balance') {
                if (!includeBalance) {
                    return;
                }
                window.toggleBalance(true);
                return;
            }

            window.toggleIndicator(indicatorId, true);
        });

        if (typeof window.updateIndicatorValues === 'function') {
            window.updateIndicatorValues();
        }
    }

    function getEditor() {
        return document.getElementById('strategy-code-editor');
    }

    function syncSettingsPanelWidth() {
        const panel = document.getElementById('settings-panel');
        const editor = getEditor();
        if (!panel || !editor) {
            return;
        }

        if (!editor.dataset.widthInitialized) {
            editor.style.width = Math.floor(window.innerWidth * 0.4) + 'px';
            editor.dataset.widthInitialized = '1';
        }

        const panelStyles = window.getComputedStyle(panel);
        const paddingLeft = parseFloat(panelStyles.paddingLeft) || 0;
        const paddingRight = parseFloat(panelStyles.paddingRight) || 0;
        const maxEditorWidth = Math.max(240, Math.floor(window.innerWidth - paddingLeft - paddingRight - 16));

        if (editor.offsetWidth > maxEditorWidth) {
            editor.style.width = maxEditorWidth + 'px';
        }

        const nextWidth = Math.ceil(editor.offsetWidth + paddingLeft + paddingRight);
        panel.style.width = nextWidth + 'px';
    }

    function getSelectedEditorFile() {
        return 'strategy-params.js';
    }

    function getSourceCache() {
        if (!window.__strategySourceByFile || typeof window.__strategySourceByFile !== 'object') {
            window.__strategySourceByFile = {};
        }
        return window.__strategySourceByFile;
    }

    function validateAppliedFile(fileName) {
        if (fileName === 'strategy-params.js') {
            return window.StrategyParams && typeof window.StrategyParams.getDefaultParams === 'function';
        }
        return true;
    }

    function loadStrategyCode(options = {}) {
        const editor = document.getElementById('strategy-code-editor');
        if (!editor) {
            log('Ошибка: текстовое поле strategy-code-editor не найдено');
            return;
        }

        const fileName = getSelectedEditorFile();
        const sourceCache = getSourceCache();
        const forceReload = options.forceReload === true;
        if (!forceReload && sourceCache[fileName]) {
            editor.value = sourceCache[fileName];
            log('Код загружен из памяти: ' + fileName);
            return;
        }

        const sourceUrl = forceReload
            ? ('./' + fileName + '?v=' + Date.now())
            : ('./' + fileName);

        fetch(sourceUrl, { cache: 'no-store' })
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.text();
            })
            .then(text => {
                sourceCache[fileName] = text;
                window.__strategyCoreSource = text;
                editor.value = text;
            })
            .catch(err => {
                log('Не удалось загрузить файл ' + fileName + ': ' + err.message);
            });
    }

    function applyStrategyCode() {
        const editor = document.getElementById('strategy-code-editor');
        if (!editor) {
            log('Ошибка: текстовое поле strategy-code-editor не найдено');
            return;
        }

        const code = editor.value.trim();
        if (!code) {
            log('Код стратегии пуст');
            return;
        }

        const fileName = getSelectedEditorFile();
        const sourceCache = getSourceCache();
        const previousSource = typeof sourceCache[fileName] === 'string' ? sourceCache[fileName] : '';
        const isSameSource = previousSource.trim() === code;

        if (isSameSource) {
            log('Код не изменён, повторный запуск без переинициализации');

            if (window.Strategy && typeof window.Strategy.testStrategy === 'function') {
                const chart = window.chartMain;
                const ts = chart && typeof chart.timeScale === 'function' ? chart.timeScale() : null;
                const previousRange = ts && typeof ts.getVisibleLogicalRange === 'function'
                    ? ts.getVisibleLogicalRange()
                    : null;

                window.Strategy.testStrategy();

                if (ts && previousRange && typeof ts.setVisibleLogicalRange === 'function') {
                    ts.setVisibleLogicalRange(previousRange);
                }
            } else if (window.data && window.data.length > 0) {
                refreshActiveIndicators();
            }

            return;
        }

        const previousDefaults = window.StrategyParams;
        const previousStrategyParams = window.Strategy && window.Strategy.params
            ? { ...window.Strategy.params }
            : null;
        const previousCache = { ...sourceCache };

        try {
            const execute = new Function(code);
            execute();

            if (validateAppliedFile(fileName)) {
                sourceCache[fileName] = code;
                window.__strategyCoreSource = code;
                log('Код успешно применён: ' + fileName);

                if (window.Strategy && window.Strategy.updateFromCore) {
                    window.Strategy.updateFromCore();
                    if (isSameSource && previousStrategyParams) {
                        window.Strategy.params = { ...window.Strategy.params, ...previousStrategyParams };
                    }
                }

                syncIndicatorSelectionFromStrategyParams();

                if (window.Strategy && typeof window.Strategy.testStrategy === 'function') {
                    const chart = window.chartMain;
                    const ts = chart && typeof chart.timeScale === 'function' ? chart.timeScale() : null;
                    const previousRange = ts && typeof ts.getVisibleLogicalRange === 'function'
                        ? ts.getVisibleLogicalRange()
                        : null;

                    window.Strategy.testStrategy();

                    if (ts && previousRange && typeof ts.setVisibleLogicalRange === 'function') {
                        ts.setVisibleLogicalRange(previousRange);
                    }

                } else if (window.data && window.data.length > 0) {
                    refreshActiveIndicators();
                }
            } else {
                window.StrategyParams = previousDefaults;
                window.__strategySourceByFile = previousCache;
                log('Ошибка: код не прошел проверку для файла ' + fileName);
            }
        } catch (err) {
            window.StrategyParams = previousDefaults;
            window.__strategySourceByFile = previousCache;
            log('Ошибка выполнения кода: ' + err.message);
        }
    }

    function resetStrategyCode() {
        const editor = document.getElementById('strategy-code-editor');
        if (!editor) {
            log('Ошибка: текстовое поле strategy-code-editor не найдено');
            return;
        }

        const fileName = getSelectedEditorFile();
        const sourceCache = getSourceCache();
        delete sourceCache[fileName];
        loadStrategyCode({ forceReload: true });
    }

    function applyAllSettings() {
        refreshActiveIndicators({ includeBalance: false });
    }

    window.StrategyEditor = {
        syncIndicatorSelectionFromStrategyParams,
        refreshActiveIndicators,
        loadStrategyCode,
        applyStrategyCode,
        resetStrategyCode,
        applyAllSettings
    };

    window.loadStrategyCode = loadStrategyCode;
    window.applyStrategyCode = applyStrategyCode;
    window.resetStrategyCode = resetStrategyCode;
    window.applyAllSettings = applyAllSettings;

    document.addEventListener('DOMContentLoaded', function() {
        loadStrategyCode({ forceReload: true });

        syncSettingsPanelWidth();

        const editor = getEditor();
        if (editor && typeof window.ResizeObserver === 'function') {
            const ro = new ResizeObserver(function() {
                syncSettingsPanelWidth();
            });
            ro.observe(editor);
        }

        window.addEventListener('resize', syncSettingsPanelWidth);

        setTimeout(function() {
            const panel = document.getElementById('settings-panel');
            if (!panel) {
                return;
            }

            const observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    if (mutation.attributeName === 'class' && panel.classList.contains('open')) {
                        loadStrategyCode({ forceReload: true });
                    }
                });
            });

            observer.observe(panel, { attributes: true });
        }, 500);
    });
})();
