// strategy-editor.js
// Strategy code editor and setting sync with indicator checkboxes.

(function() {
    'use strict';

    const STRATEGY_STORAGE_KEY = 'selectedStrategyFile';
    const STRATEGY_FILE_PATTERN = /^strategy-(?:params|\([a-z0-9-]+\))\.js$/i;
    const AUTORUN_STRATEGY = 'strategy-(autorun).js';
    const FALLBACK_STRATEGIES = [
        { file: 'strategy-(autorun).js', label: 'Autorun' },
        { file: 'strategy-(bb-stoch).js', label: 'BB + Stochastic' }
    ];

    let resolveInitialStrategyReady;
    const initialStrategyReady = new Promise(resolve => {
        resolveInitialStrategyReady = resolve;
    });
    let initialStrategyReadySettled = false;

    window.__strategySelectionReadyPromise = initialStrategyReady;

    function log(message) {
        if (typeof window.addLog === 'function') {
            window.addLog(message);
        }
    }

    function settleInitialStrategyReady() {
        if (!initialStrategyReadySettled) {
            initialStrategyReadySettled = true;
            resolveInitialStrategyReady();
        }
    }

    function formatStrategyLabel(fileName) {
        const rawName = String(fileName || '')
            .replace(/^strategy-(?:params-?|\()/i, '')
            .replace(/\)\.js$/i, '')
            .replace(/\.js$/i, '');

        if (!rawName || rawName === 'strategy-params') {
            return 'Default';
        }

        return rawName
            .split('-')
            .filter(Boolean)
            .map(part => part.length <= 4 ? part.toUpperCase() : (part.charAt(0).toUpperCase() + part.slice(1)))
            .join(' + ');
    }

    function normalizeStrategyDefinition(entry, index) {
        if (typeof entry === 'string') {
            return {
                id: `strategy-${index + 1}`,
                file: entry,
                label: formatStrategyLabel(entry)
            };
        }

        if (!entry || typeof entry !== 'object' || typeof entry.file !== 'string') {
            return null;
        }

        return {
            id: typeof entry.id === 'string' && entry.id ? entry.id : `strategy-${index + 1}`,
            file: entry.file,
            label: typeof entry.label === 'string' && entry.label ? entry.label : formatStrategyLabel(entry.file)
        };
    }

    function getRegisteredStrategies() {
        const rawStrategies = Array.isArray(window.STRATEGY_FILES) && window.STRATEGY_FILES.length
            ? window.STRATEGY_FILES
            : FALLBACK_STRATEGIES;
        const seenFiles = new Set();

        return rawStrategies
            .map(normalizeStrategyDefinition)
            .filter(strategy => {
                if (!strategy || !STRATEGY_FILE_PATTERN.test(strategy.file) || seenFiles.has(strategy.file)) {
                    return false;
                }
                seenFiles.add(strategy.file);
                return true;
            });
    }

    function getStrategySelect() {
        return document.getElementById('strategy-file-select');
    }

    function getStoredStrategyFile() {
        try {
            return window.localStorage ? window.localStorage.getItem(STRATEGY_STORAGE_KEY) : null;
        } catch (err) {
            return null;
        }
    }

    function storeSelectedStrategyFile(fileName) {
        try {
            if (window.localStorage && fileName) {
                window.localStorage.setItem(STRATEGY_STORAGE_KEY, fileName);
            }
        } catch (err) {
            log('Не удалось сохранить выбранную стратегию: ' + err.message);
        }
    }

    function getCurrentStrategyDefinition() {
        const strategies = getRegisteredStrategies();
        if (!strategies.length) {
            return null;
        }

        const select = getStrategySelect();
        const preferredFile = (select && select.value) || getStoredStrategyFile();
        return strategies.find(strategy => strategy.file === preferredFile) || strategies[0];
    }

    async function checkFileExists(fileName) {
        try {
            const response = await fetch('./' + fileName, { method: 'HEAD', cache: 'no-store' });
            return response.ok;
        } catch (err) {
            return false;
        }
    }

    function syncStrategySelectOptions() {
        const select = getStrategySelect();
        if (!select) {
            return null;
        }

        const strategies = getRegisteredStrategies();
        const preferredFile = (select.value || getStoredStrategyFile());
        select.innerHTML = '';

        strategies.forEach(strategy => {
            const option = document.createElement('option');
            option.value = strategy.file;
            option.textContent = strategy.label;
            select.appendChild(option);
        });

        const selected = strategies.find(strategy => strategy.file === preferredFile) || strategies[0] || null;
        if (selected) {
            select.value = selected.file;
            storeSelectedStrategyFile(selected.file);
        }

        return selected;
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

    function cacheCurrentEditorValue() {
        const editor = getEditor();
        const activeFile = window.__activeStrategyFile;
        if (!editor || !activeFile) {
            return;
        }

        getSourceCache()[activeFile] = editor.value;
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
        const selected = getCurrentStrategyDefinition();
        return selected ? selected.file : null;
    }

    function getSourceCache() {
        if (!window.__strategySourceByFile || typeof window.__strategySourceByFile !== 'object') {
            window.__strategySourceByFile = {};
        }
        return window.__strategySourceByFile;
    }

    function validateAppliedFile(fileName) {
        return STRATEGY_FILE_PATTERN.test(fileName || '')
            && window.StrategyParams
            && typeof window.StrategyParams.getDefaultParams === 'function';
    }

    async function loadStrategyCode(options = {}) {
        const editor = document.getElementById('strategy-code-editor');
        if (!editor) {
            log('Ошибка: текстовое поле strategy-code-editor не найдено');
            return null;
        }

        const fileName = options.fileName || getSelectedEditorFile();
        if (!fileName) {
            log('Стратегия не выбрана');
            return null;
        }

        window.__activeStrategyFile = fileName;
        storeSelectedStrategyFile(fileName);

        const sourceCache = getSourceCache();
        const forceReload = options.forceReload === true;
        if (!forceReload && typeof sourceCache[fileName] === 'string') {
            editor.value = sourceCache[fileName];
            log('Код загружен из памяти: ' + fileName);
            return sourceCache[fileName];
        }

        const sourceUrl = forceReload
            ? ('./' + fileName + '?v=' + Date.now())
            : ('./' + fileName);

        try {
            const response = await fetch(sourceUrl, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const text = await response.text();
            sourceCache[fileName] = text;
            window.__strategyCoreSource = text;
            editor.value = text;
            return text;
        } catch (err) {
            log('Не удалось загрузить файл ' + fileName + ': ' + err.message);
            return null;
        }
    }

    function rerunStrategyPreview() {
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
    }

    function applyStrategyCode(options = {}) {
        const editor = document.getElementById('strategy-code-editor');
        if (!editor) {
            log('Ошибка: текстовое поле strategy-code-editor не найдено');
            return false;
        }

        const code = editor.value.trim();
        if (!code) {
            log('Код стратегии пуст');
            return false;
        }

        const fileName = options.fileName || getSelectedEditorFile();
        if (!fileName) {
            log('Стратегия не выбрана');
            return false;
        }

        const sourceCache = getSourceCache();
        const previousSource = typeof sourceCache[fileName] === 'string' ? sourceCache[fileName] : '';
        const isSameSource = previousSource.trim() === code;

        if (isSameSource) {
            log('Код не изменён, повторный запуск без переинициализации');
            rerunStrategyPreview();
            return true;
        }

        const previousDefaults = window.StrategyParams;
        const previousCache = { ...sourceCache };

        try {
            const execute = new Function(code);
            execute();

            if (validateAppliedFile(fileName)) {
                sourceCache[fileName] = code;
                window.__strategyCoreSource = code;
                window.__activeStrategyFile = fileName;
                storeSelectedStrategyFile(fileName);
                log('Код успешно применён: ' + fileName);

                if (window.Strategy && window.Strategy.updateFromCore) {
                    window.Strategy.updateFromCore();
                }

                syncIndicatorSelectionFromStrategyParams();
                rerunStrategyPreview();
                return true;
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

        return false;
    }

    async function selectStrategy(fileName, options = {}) {
        if (!fileName) {
            settleInitialStrategyReady();
            return false;
        }

        cacheCurrentEditorValue();

        const select = getStrategySelect();
        if (select && select.value !== fileName) {
            select.value = fileName;
        }

        const loadedCode = await loadStrategyCode({
            fileName,
            forceReload: options.forceReload === true
        });

        if (loadedCode === null) {
            settleInitialStrategyReady();
            return false;
        }

        const applied = options.apply === false
            ? true
            : applyStrategyCode({ fileName });
        settleInitialStrategyReady();
        return applied;
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
        selectStrategy(fileName, { forceReload: true, apply: false });
    }

    function applyAllSettings() {
        refreshActiveIndicators({ includeBalance: false });
    }

    window.StrategyEditor = {
        getRegisteredStrategies,
        getCurrentStrategyDefinition,
        ensureInitialStrategyReady: function() {
            return initialStrategyReady;
        },
        hasActiveStrategy: function() {
            return Boolean(getCurrentStrategyDefinition());
        },
        syncIndicatorSelectionFromStrategyParams,
        refreshActiveIndicators,
        loadStrategyCode,
        applyStrategyCode,
        selectStrategy,
        resetStrategyCode,
        applyAllSettings
    };

    window.loadStrategyCode = loadStrategyCode;
    window.applyStrategyCode = applyStrategyCode;
    window.selectStrategy = selectStrategy;
    window.resetStrategyCode = resetStrategyCode;
    window.applyAllSettings = applyAllSettings;

    document.addEventListener('DOMContentLoaded', async function() {
        const selectedStrategy = syncStrategySelectOptions();

        const strategySelect = getStrategySelect();
        if (strategySelect) {
            strategySelect.addEventListener('change', function(event) {
                selectStrategy(event.target.value, { forceReload: false, apply: true });
            });
        }

        // Если strategy-(autorun).js существует на сервере — выбрать его автоматически
        let initialFile = selectedStrategy ? selectedStrategy.file : null;
        const autorunExists = await checkFileExists(AUTORUN_STRATEGY);
        if (autorunExists) {
            const strategies = getRegisteredStrategies();
            const autorunDef = strategies.find(s => s.file === AUTORUN_STRATEGY);
            if (autorunDef) {
                initialFile = AUTORUN_STRATEGY;
                if (strategySelect) {
                    strategySelect.value = AUTORUN_STRATEGY;
                }
                log('Autorun strategy detected, selecting: ' + AUTORUN_STRATEGY);
            }
        }

        selectStrategy(initialFile, { forceReload: true, apply: true });

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
                        const fileName = getSelectedEditorFile();
                        if (fileName) {
                            loadStrategyCode({ forceReload: true, fileName });
                        }
                    }
                });
            });

            observer.observe(panel, { attributes: true });
        }, 500);
    });
})();
