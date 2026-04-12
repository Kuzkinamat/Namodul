// strategy-editor.js
// Strategy code editor and setting sync with indicator checkboxes.

(function() {
    'use strict';

    const STRATEGY_STORAGE_KEY = 'selectedStrategyFile';
    const STRATEGY_FILE_PATTERN = /^strategy-(?:params|\([a-z0-9-]+\))\.js$/i;
    const AUTORUN_STRATEGY = 'strategy-(autorun).js';
    const SETTINGS_PANEL_POSITION_KEY = 'settingsPanelPosition';
    const SETTINGS_PANEL_MARGIN = 8;
    const SETTINGS_PANEL_MIN_TOP = 53;
    const EDITOR_PANEL_POSITION_KEY_PREFIX = 'strategyEditorPanelPosition:';
    const FLOATING_PANEL_DEFAULTS = Object.freeze({
        ind: { left: 24, top: 98 },
        mm: { left: 24, top: 300 },
        hours: { left: 24, top: 502 }
    });
    const EDITOR_WINDOW_TYPES = Object.freeze(['ind', 'mm', 'hours', 'code']);
    const FALLBACK_STRATEGIES = [
        { file: 'strategy-(autorun).js', label: 'Autorun' }
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
            useWorktime: 'Worktime',
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

    function getIndicatorsEditor() {
        return document.getElementById('strategy-ind-editor');
    }

    function getMoneyManagementEditor() {
        return document.getElementById('strategy-mm-editor');
    }

    function getHoursEditor() {
        return document.getElementById('strategy-hours-editor');
    }

    function getEditorMap() {
        return {
            ind: getIndicatorsEditor(),
            mm: getMoneyManagementEditor(),
            hours: getHoursEditor(),
            code: getEditor()
        };
    }

    function getInlineCodePanel() {
        return document.getElementById('strategy-inline-code-panel');
    }

    function getFloatingEditorPanel(type) {
        return document.getElementById('strategy-editor-' + type + '-panel');
    }

    function getFloatingEditorPanels() {
        return {
            ind: getFloatingEditorPanel('ind'),
            mm: getFloatingEditorPanel('mm'),
            hours: getFloatingEditorPanel('hours')
        };
    }

    function getEditorToggleButton(type) {
        return document.querySelector('[data-editor-toggle="' + type + '"]');
    }

    function getSettingsPanel() {
        return document.getElementById('settings-panel');
    }

    function isInlineCodeOpen() {
        const panel = getInlineCodePanel();
        return Boolean(panel && panel.classList.contains('open'));
    }

    function setInlineCodeOpen(isOpen) {
        const codePanel = getInlineCodePanel();
        const settingsPanel = getSettingsPanel();
        if (!codePanel || !settingsPanel) {
            return;
        }

        codePanel.classList.toggle('open', isOpen);
        settingsPanel.classList.toggle('code-editor-open', isOpen);
        if (!isOpen) {
            settingsPanel.style.width = '';
            settingsPanel.style.height = '';
        }
        updateEditorToggleButtons();
        syncSettingsPanelLayout();
    }

    function openCodeBuilder() {
        setInlineCodeOpen(true);
        const editor = getEditor();
        if (editor) {
            editor.focus();
        }
        log('Builder: заготовка для конструктора кода. Следующим шагом можно добавить шаблоны блоков и условий.');
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function isInteractiveDragTarget(target) {
        return Boolean(
            target
            && typeof target.closest === 'function'
            && target.closest('button, input, select, textarea, label, a')
        );
    }

    function getStoredSettingsPanelPosition() {
        try {
            if (!window.localStorage) {
                return null;
            }

            const raw = window.localStorage.getItem(SETTINGS_PANEL_POSITION_KEY);
            if (!raw) {
                return null;
            }

            const parsed = JSON.parse(raw);
            if (!parsed || !Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) {
                return null;
            }

            return parsed;
        } catch (err) {
            return null;
        }
    }

    function storeSettingsPanelPosition(left, top) {
        try {
            if (window.localStorage) {
                window.localStorage.setItem(SETTINGS_PANEL_POSITION_KEY, JSON.stringify({ left, top }));
            }
        } catch (err) {
            log('Не удалось сохранить позицию окна стратегии: ' + err.message);
        }
    }

    function getCurrentSettingsPanelLeft(panel) {
        const parsed = parseFloat(panel.style.left);
        return Number.isFinite(parsed) ? parsed : SETTINGS_PANEL_MARGIN;
    }

    function getCurrentSettingsPanelTop(panel) {
        const parsed = parseFloat(panel.style.top);
        return Number.isFinite(parsed) ? parsed : SETTINGS_PANEL_MIN_TOP;
    }

    function updateSettingsPanelMaxHeight(panel, top) {
        const nextTop = Number.isFinite(top) ? top : getCurrentSettingsPanelTop(panel);
        const maxHeight = Math.max(220, Math.floor(window.innerHeight - nextTop - SETTINGS_PANEL_MARGIN));
        panel.style.maxHeight = maxHeight + 'px';
    }

    function applySettingsPanelPosition(left, top, options = {}) {
        const panel = getSettingsPanel();
        if (!panel) {
            return;
        }

        const persist = options.persist !== false;
        updateSettingsPanelMaxHeight(panel, top);

        const panelWidth = Math.ceil(panel.getBoundingClientRect().width || panel.offsetWidth || 0);
        const panelHeight = Math.ceil(panel.getBoundingClientRect().height || panel.offsetHeight || 0);
        const maxLeft = Math.max(SETTINGS_PANEL_MARGIN, Math.floor(window.innerWidth - panelWidth - SETTINGS_PANEL_MARGIN));
        const maxTop = Math.max(SETTINGS_PANEL_MIN_TOP, Math.floor(window.innerHeight - panelHeight - SETTINGS_PANEL_MARGIN));

        const nextLeft = clamp(Math.round(left), SETTINGS_PANEL_MARGIN, maxLeft);
        const nextTop = clamp(Math.round(top), SETTINGS_PANEL_MIN_TOP, maxTop);

        panel.style.left = nextLeft + 'px';
        panel.style.top = nextTop + 'px';
        updateSettingsPanelMaxHeight(panel, nextTop);

        const adjustedHeight = Math.ceil(panel.getBoundingClientRect().height || panel.offsetHeight || 0);
        const adjustedMaxTop = Math.max(SETTINGS_PANEL_MIN_TOP, Math.floor(window.innerHeight - adjustedHeight - SETTINGS_PANEL_MARGIN));
        const finalTop = clamp(nextTop, SETTINGS_PANEL_MIN_TOP, adjustedMaxTop);

        if (finalTop !== nextTop) {
            panel.style.top = finalTop + 'px';
            updateSettingsPanelMaxHeight(panel, finalTop);
        }

        if (persist) {
            storeSettingsPanelPosition(nextLeft, finalTop);
        }
    }

    function ensureSettingsPanelVisible() {
        const panel = getSettingsPanel();
        if (!panel) {
            return;
        }

        applySettingsPanelPosition(
            getCurrentSettingsPanelLeft(panel),
            getCurrentSettingsPanelTop(panel),
            { persist: false }
        );
    }

    function initSettingsPanelPosition() {
        const panel = getSettingsPanel();
        if (!panel) {
            return;
        }

        const storedPosition = getStoredSettingsPanelPosition();
        const initialLeft = storedPosition ? storedPosition.left : SETTINGS_PANEL_MARGIN;
        const initialTop = storedPosition ? storedPosition.top : SETTINGS_PANEL_MIN_TOP;
        applySettingsPanelPosition(initialLeft, initialTop, { persist: false });
    }

    function bindSettingsPanelDragging() {
        const panel = getSettingsPanel();
        const dragHandle = panel ? panel.querySelector('[data-settings-drag-handle="true"]') : null;
        if (!panel || !dragHandle || dragHandle.dataset.dragBound === '1') {
            return;
        }

        dragHandle.dataset.dragBound = '1';

        dragHandle.addEventListener('pointerdown', function(event) {
            if (event.button !== 0 && event.pointerType !== 'touch') {
                return;
            }

            const startX = event.clientX;
            const startY = event.clientY;
            const startLeft = getCurrentSettingsPanelLeft(panel);
            const startTop = getCurrentSettingsPanelTop(panel);

            panel.classList.add('dragging');
            if (typeof dragHandle.setPointerCapture === 'function') {
                dragHandle.setPointerCapture(event.pointerId);
            }

            const handlePointerMove = function(moveEvent) {
                applySettingsPanelPosition(
                    startLeft + (moveEvent.clientX - startX),
                    startTop + (moveEvent.clientY - startY),
                    { persist: false }
                );
            };

            const stopDragging = function(endEvent) {
                panel.classList.remove('dragging');
                dragHandle.removeEventListener('pointermove', handlePointerMove);
                dragHandle.removeEventListener('pointerup', stopDragging);
                dragHandle.removeEventListener('pointercancel', stopDragging);
                dragHandle.removeEventListener('lostpointercapture', stopDragging);

                if (typeof dragHandle.releasePointerCapture === 'function' && dragHandle.hasPointerCapture(event.pointerId)) {
                    dragHandle.releasePointerCapture(event.pointerId);
                }

                applySettingsPanelPosition(
                    getCurrentSettingsPanelLeft(panel),
                    getCurrentSettingsPanelTop(panel),
                    { persist: true }
                );

                if (endEvent) {
                    endEvent.preventDefault();
                }
            };

            dragHandle.addEventListener('pointermove', handlePointerMove);
            dragHandle.addEventListener('pointerup', stopDragging);
            dragHandle.addEventListener('pointercancel', stopDragging);
            dragHandle.addEventListener('lostpointercapture', stopDragging);
            event.preventDefault();
        });
    }

    function getStoredFloatingPanelPosition(type) {
        try {
            if (!window.localStorage) {
                return null;
            }

            const raw = window.localStorage.getItem(EDITOR_PANEL_POSITION_KEY_PREFIX + type);
            if (!raw) {
                return null;
            }

            const parsed = JSON.parse(raw);
            if (!parsed || !Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) {
                return null;
            }

            return parsed;
        } catch (err) {
            return null;
        }
    }

    function storeFloatingPanelPosition(type, left, top) {
        try {
            if (window.localStorage) {
                window.localStorage.setItem(EDITOR_PANEL_POSITION_KEY_PREFIX + type, JSON.stringify({ left, top }));
            }
        } catch (err) {
            log('Не удалось сохранить позицию окна редактора ' + type + ': ' + err.message);
        }
    }

    function getCurrentFloatingPanelLeft(panel, type) {
        const parsed = parseFloat(panel.style.left);
        return Number.isFinite(parsed) ? parsed : FLOATING_PANEL_DEFAULTS[type].left;
    }

    function getCurrentFloatingPanelTop(panel, type) {
        const parsed = parseFloat(panel.style.top);
        return Number.isFinite(parsed) ? parsed : FLOATING_PANEL_DEFAULTS[type].top;
    }

    function syncFloatingPanelSize(type) {
        const panel = getFloatingEditorPanel(type);
        const editor = getEditorMap()[type];
        if (!panel || !editor) {
            return;
        }
    }

    function applyFloatingPanelPosition(type, left, top, options = {}) {
        const panel = getFloatingEditorPanel(type);
        if (!panel) {
            return;
        }

        const persist = options.persist !== false;
        syncFloatingPanelSize(type);
        const panelWidth = Math.ceil(panel.getBoundingClientRect().width || panel.offsetWidth || 0);
        const panelHeight = Math.ceil(panel.getBoundingClientRect().height || panel.offsetHeight || 0);
        const maxLeft = Math.max(SETTINGS_PANEL_MARGIN, Math.floor(window.innerWidth - panelWidth - SETTINGS_PANEL_MARGIN));
        const maxTop = Math.max(SETTINGS_PANEL_MIN_TOP, Math.floor(window.innerHeight - panelHeight - SETTINGS_PANEL_MARGIN));
        const nextLeft = clamp(Math.round(left), SETTINGS_PANEL_MARGIN, maxLeft);
        const nextTop = clamp(Math.round(top), SETTINGS_PANEL_MIN_TOP, maxTop);

        panel.style.left = nextLeft + 'px';
        panel.style.top = nextTop + 'px';

        if (persist) {
            storeFloatingPanelPosition(type, nextLeft, nextTop);
        }
    }

    function syncFloatingPanelLayout(options = {}) {
        const panels = getFloatingEditorPanels();
        Object.entries(panels).forEach(function(entry) {
            const type = entry[0];
            const panel = entry[1];
            if (!panel) {
                return;
            }

            applyFloatingPanelPosition(
                type,
                getCurrentFloatingPanelLeft(panel, type),
                getCurrentFloatingPanelTop(panel, type),
                { persist: options.persist === true }
            );
        });
    }

    function initFloatingPanelPositions() {
        Object.keys(FLOATING_PANEL_DEFAULTS).forEach(function(type) {
            const stored = getStoredFloatingPanelPosition(type);
            const defaults = FLOATING_PANEL_DEFAULTS[type];
            applyFloatingPanelPosition(
                type,
                stored ? stored.left : defaults.left,
                stored ? stored.top : defaults.top,
                { persist: false }
            );
        });
    }

    function bindFloatingPanelDragging() {
        Object.keys(FLOATING_PANEL_DEFAULTS).forEach(function(type) {
            const panel = getFloatingEditorPanel(type);
            const dragHandle = panel ? panel.querySelector('[data-editor-drag-handle="' + type + '"]') : null;
            if (!panel || !dragHandle || dragHandle.dataset.dragBound === '1') {
                return;
            }

            dragHandle.dataset.dragBound = '1';
            dragHandle.addEventListener('pointerdown', function(event) {
                if (event.button !== 0 && event.pointerType !== 'touch') {
                    return;
                }
                if (isInteractiveDragTarget(event.target)) {
                    return;
                }

                const startX = event.clientX;
                const startY = event.clientY;
                const startLeft = getCurrentFloatingPanelLeft(panel, type);
                const startTop = getCurrentFloatingPanelTop(panel, type);

                panel.classList.add('dragging');
                if (typeof dragHandle.setPointerCapture === 'function') {
                    dragHandle.setPointerCapture(event.pointerId);
                }

                const handlePointerMove = function(moveEvent) {
                    applyFloatingPanelPosition(
                        type,
                        startLeft + (moveEvent.clientX - startX),
                        startTop + (moveEvent.clientY - startY),
                        { persist: false }
                    );
                };

                const stopDragging = function(endEvent) {
                    panel.classList.remove('dragging');
                    dragHandle.removeEventListener('pointermove', handlePointerMove);
                    dragHandle.removeEventListener('pointerup', stopDragging);
                    dragHandle.removeEventListener('pointercancel', stopDragging);
                    dragHandle.removeEventListener('lostpointercapture', stopDragging);

                    if (typeof dragHandle.releasePointerCapture === 'function' && dragHandle.hasPointerCapture(event.pointerId)) {
                        dragHandle.releasePointerCapture(event.pointerId);
                    }

                    applyFloatingPanelPosition(
                        type,
                        getCurrentFloatingPanelLeft(panel, type),
                        getCurrentFloatingPanelTop(panel, type),
                        { persist: true }
                    );

                    if (endEvent) {
                        endEvent.preventDefault();
                    }
                };

                dragHandle.addEventListener('pointermove', handlePointerMove);
                dragHandle.addEventListener('pointerup', stopDragging);
                dragHandle.addEventListener('pointercancel', stopDragging);
                dragHandle.addEventListener('lostpointercapture', stopDragging);
                event.preventDefault();
            });
        });
    }

    function isFloatingEditorOpen(type) {
        const panel = getFloatingEditorPanel(type);
        return Boolean(panel && panel.classList.contains('open'));
    }

    function updateEditorToggleButtons() {
        EDITOR_WINDOW_TYPES.forEach(function(type) {
            const button = getEditorToggleButton(type);
            if (!button) {
                return;
            }

            button.classList.toggle('active', type === 'code' ? isInlineCodeOpen() : isFloatingEditorOpen(type));
        });
    }

    function setEditorWindowOpen(type, isOpen) {
        if (type === 'code') {
            setInlineCodeOpen(isOpen);
            return;
        }

        setFloatingEditorOpen(type, isOpen);
    }

    function setFloatingEditorOpen(type, isOpen) {
        const panel = getFloatingEditorPanel(type);
        if (!panel) {
            return;
        }

        panel.classList.toggle('open', isOpen);
        if (isOpen) {
            const openPanels = Object.values(getFloatingEditorPanels()).filter(Boolean);
            const maxZIndex = openPanels.reduce(function(maxValue, currentPanel) {
                const value = Number(window.getComputedStyle(currentPanel).zIndex) || 1998;
                return Math.max(maxValue, value);
            }, 1998);
            panel.style.zIndex = String(maxZIndex + 1);
            syncFloatingPanelLayout();
        }

        updateEditorToggleButtons();
    }

    function toggleStrategyEditorWindow(type) {
        if (type === 'code') {
            setInlineCodeOpen(!isInlineCodeOpen());
            return;
        }

        setFloatingEditorOpen(type, !isFloatingEditorOpen(type));
    }

    function focusStrategyEditorWindow(type) {
        setEditorWindowOpen(type, true);
    }

    function syncSettingsPanelWidth() {
        const panel = getSettingsPanel();
        if (!panel) {
            return;
        }

        if (isInlineCodeOpen()) {
            return;
        }

        panel.style.width = '';
        panel.style.height = '';
    }

    function syncSettingsPanelLayout(options = {}) {
        syncSettingsPanelWidth();
        ensureSettingsPanelVisible();
        syncFloatingPanelLayout({ persist: options.persist === true });

        if (options.persist === true) {
            const panel = getSettingsPanel();
            if (panel) {
                storeSettingsPanelPosition(getCurrentSettingsPanelLeft(panel), getCurrentSettingsPanelTop(panel));
            }
        }
    }

    function getSelectedEditorFile() {
        const selected = getCurrentStrategyDefinition();
        return selected ? selected.file : null;
    }

    function extractDefinitionSection(source, sectionName) {
        const marker = 'const ' + sectionName + ' = Object.freeze({';
        const start = source.indexOf(marker);
        if (start === -1) {
            throw new Error('Не найден блок ' + sectionName);
        }

        const openBraceIndex = source.indexOf('{', start);
        if (openBraceIndex === -1) {
            throw new Error('Не найдено начало объекта ' + sectionName);
        }

        let depth = 0;
        for (let index = openBraceIndex; index < source.length; index++) {
            const char = source[index];
            if (char === '{') {
                depth += 1;
            } else if (char === '}') {
                depth -= 1;
                if (depth === 0) {
                    return source.slice(openBraceIndex, index + 1);
                }
            }
        }

        throw new Error('Не удалось разобрать объект ' + sectionName);
    }

    function extractTemplateLiteral(source, constName) {
        const marker = 'const ' + constName + ' = `';
        const start = source.indexOf(marker);
        if (start === -1) {
            throw new Error('Не найден блок ' + constName);
        }

        const contentStart = start + marker.length;
        const contentEnd = source.indexOf('`;', contentStart);
        if (contentEnd === -1) {
            throw new Error('Не удалось разобрать шаблон ' + constName);
        }

        return source.slice(contentStart, contentEnd);
    }

    function parseUnifiedStrategySource(source) {
        return {
            ind: extractDefinitionSection(source, 'indicatorSettings'),
            mm: extractDefinitionSection(source, 'moneyManagementSettings'),
            hours: extractDefinitionSection(source, 'hoursSettings'),
            code: extractTemplateLiteral(source, 'logicSource')
        };
    }

    function escapeTemplateLiteralContent(value) {
        return String(value || '')
            .replace(/\\/g, '\\\\')
            .replace(/`/g, '\\`')
            .replace(/\$\{/g, '\\${');
    }

    function buildUnifiedStrategySource(parts) {
        const indicatorSettings = String(parts && parts.ind ? parts.ind : '').trim();
        const moneyManagementSettings = String(parts && parts.mm ? parts.mm : '').trim();
        const hoursSettings = String(parts && parts.hours ? parts.hours : '').trim();
        const logicSource = String(parts && parts.code ? parts.code : '').replace(/\r\n/g, '\n').trim();

        if (!indicatorSettings || !moneyManagementSettings || !hoursSettings || !logicSource) {
            throw new Error('Недостаточно данных для сборки strategy definition');
        }

        const escapedLogicSource = escapeTemplateLiteralContent(logicSource);

        return [
            '// strategy-(autorun).js',
            '// Unified strategy definition for the Autorun strategy.',
            '',
            'window.StrategyDefinition = (function() {',
            "    'use strict';",
            '',
            '    function buildLogicEvaluator(source) {',
            "        const logicBody = String(source || '').trim();",
            '        if (!logicBody) {',
            '            return function() {',
            '                return { buy: 0, sell: 0 };',
            '            };',
            '        }',
            '',
            "        const evaluator = new Function('ctx', `let buy = 0, sell = 0;\\n${logicBody}\\nreturn { buy, sell };`);",
            '        return function(ctx) {',
            '            const result = evaluator(ctx);',
            "            if (!result || typeof result !== 'object') {",
            '                return { buy: 0, sell: 0 };',
            '            }',
            '',
            '            return {',
            '                buy: Number.isFinite(result.buy) ? result.buy : 0,',
            '                sell: Number.isFinite(result.sell) ? result.sell : 0',
            '            };',
            '        };',
            '    }',
            '',
            '    const indicatorSettings = Object.freeze(' + indicatorSettings + ');',
            '',
            '    const moneyManagementSettings = Object.freeze(' + moneyManagementSettings + ');',
            '',
            '    const hoursSettings = Object.freeze(' + hoursSettings + ');',
            '',
            '    const logicSource = `',
            escapedLogicSource,
            '`;',
            '',
            '    const evaluateLogic = buildLogicEvaluator(logicSource);',
            '',
            '    const DEFAULT_PARAMS = Object.freeze({',
            '        ...moneyManagementSettings,',
            '        ...hoursSettings,',
            '        ...indicatorSettings',
            '    });',
            '',
            '    function getDefaultParams() {',
            '        return { ...DEFAULT_PARAMS };',
            '    }',
            '',
            '    function normalizeParams(params) {',
            '        return { ...DEFAULT_PARAMS, ...(params || {}) };',
            '    }',
            '',
            '    return {',
            '        meta: Object.freeze({',
            "            id: 'autorun',",
            "            label: 'Autorun'",
            '        }),',
            '        settings: Object.freeze({',
            '            indicators: indicatorSettings,',
            '            moneyManagement: moneyManagementSettings,',
            '            hours: hoursSettings',
            '        }),',
            '        logic: Object.freeze({',
            '            source: logicSource,',
            '            evaluate: evaluateLogic',
            '        }),',
            '        DEFAULT_PARAMS,',
            '        getDefaultParams,',
            '        normalizeParams',
            '    };',
            '})();',
            '',
            'window.StrategyParams = (function(definition) {',
            "    'use strict';",
            '',
            "    const defaultParams = definition && typeof definition.getDefaultParams === 'function'",
            '        ? Object.freeze(definition.getDefaultParams())',
            '        : Object.freeze({});',
            '',
            '    function getDefaultParams() {',
            '        return { ...defaultParams };',
            '    }',
            '',
            '    function normalizeParams(params) {',
            '        return { ...defaultParams, ...(params || {}) };',
            '    }',
            '',
            '    return {',
            '        DEFAULT_PARAMS: defaultParams,',
            '        getDefaultParams,',
            '        normalizeParams',
            '    };',
            '})(window.StrategyDefinition);',
            ''
        ].join('\n');
    }

    function validateAppliedFile(fileName) {
        return STRATEGY_FILE_PATTERN.test(fileName || '')
            && window.StrategyDefinition
            && window.StrategyDefinition.logic
            && typeof window.StrategyDefinition.logic.evaluate === 'function'
            && window.StrategyParams
            && typeof window.StrategyParams.getDefaultParams === 'function';
    }

    async function fetchTextFile(fileName, options = {}) {
        const sourceUrl = options.forceReload === true
            ? ('./' + fileName + '?v=' + Date.now())
            : ('./' + fileName);

        const response = await fetch(sourceUrl, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return response.text();
    }

    async function loadStrategyCode(options = {}) {
        const editors = getEditorMap();
        if (!editors.ind || !editors.mm || !editors.hours || !editors.code) {
            log('Ошибка: текстовые поля редактора не найдены');
            return null;
        }

        const fileName = options.fileName || getSelectedEditorFile();
        if (!fileName) {
            log('Стратегия не выбрана');
            return null;
        }

        window.__activeStrategyFile = fileName;
        storeSelectedStrategyFile(fileName);

        try {
            const mainText = await fetchTextFile(fileName, options);
            const parsed = parseUnifiedStrategySource(mainText);

            editors.ind.value = parsed.ind;
            editors.mm.value = parsed.mm;
            editors.hours.value = parsed.hours;
            editors.code.value = parsed.code;
            window.__strategyCoreSource = mainText;
            return {
                ind: parsed.ind,
                mm: parsed.mm,
                hours: parsed.hours,
                code: parsed.code,
                main: mainText
            };
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
        const editors = getEditorMap();
        if (!editors.ind || !editors.mm || !editors.hours || !editors.code) {
            log('Ошибка: текстовые поля редактора не найдены');
            return false;
        }

        const indCode = editors.ind.value.trim();
        const mmCode = editors.mm.value.trim();
        const hoursCode = editors.hours.value.trim();
        const strategyCode = editors.code.value.trim();
        if (!indCode || !mmCode || !hoursCode || !strategyCode) {
            log('Один из редакторов пуст');
            return false;
        }

        const fileName = options.fileName || getSelectedEditorFile();
        if (!fileName) {
            log('Стратегия не выбрана');
            return false;
        }

        const previousDefinition = window.StrategyDefinition;
        const previousDefaults = window.StrategyParams;

        try {
            const mainCode = buildUnifiedStrategySource({
                ind: indCode,
                mm: mmCode,
                hours: hoursCode,
                code: strategyCode
            });

            const finalize = function(compiledMainCode) {
                new Function(compiledMainCode)();

                if (!validateAppliedFile(fileName)) {
                    throw new Error('Код не прошел проверку для файла ' + fileName);
                }

                window.__strategyCoreSource = compiledMainCode;
                window.__activeStrategyFile = fileName;
                storeSelectedStrategyFile(fileName);
                log('Код успешно применён: ' + fileName);

                if (window.Strategy && window.Strategy.updateFromCore) {
                    window.Strategy.updateFromCore();
                }

                syncIndicatorSelectionFromStrategyParams();
                rerunStrategyPreview();
                return true;
            };

            return finalize(mainCode);
        } catch (err) {
            window.StrategyDefinition = previousDefinition;
            window.StrategyParams = previousDefaults;
            log('Ошибка выполнения кода: ' + err.message);
        }

        return false;
    }

    async function selectStrategy(fileName, options = {}) {
        if (!fileName) {
            settleInitialStrategyReady();
            return false;
        }

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
            : await Promise.resolve(applyStrategyCode({ fileName, forceReload: false }));
        settleInitialStrategyReady();
        return applied;
    }

    function resetStrategyCode() {
        const editors = getEditorMap();
        if (!editors.ind || !editors.mm || !editors.hours || !editors.code) {
            log('Ошибка: текстовые поля редактора не найдены');
            return;
        }

        const fileName = getSelectedEditorFile();
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
        ensureSettingsPanelVisible,
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
    window.focusStrategyEditorWindow = focusStrategyEditorWindow;
    window.toggleStrategyEditorWindow = toggleStrategyEditorWindow;
    window.openCodeBuilder = openCodeBuilder;

    document.addEventListener('DOMContentLoaded', async function() {
        try {
            delete window.__strategySourceByFile;
            if (window.localStorage) {
                window.localStorage.removeItem(STRATEGY_STORAGE_KEY);
            }
        } catch (err) {
        }

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

        initSettingsPanelPosition();
        initFloatingPanelPositions();
        syncSettingsPanelLayout();
        bindSettingsPanelDragging();
        bindFloatingPanelDragging();
        updateEditorToggleButtons();

        const editor = getEditor();
        if (editor && typeof window.ResizeObserver === 'function') {
            const ro = new ResizeObserver(function() {
                syncSettingsPanelLayout();
            });
            Object.values(getEditorMap()).forEach(function(currentEditor) {
                if (currentEditor) {
                    ro.observe(currentEditor);
                }
            });
        }

        window.addEventListener('resize', function() {
            syncSettingsPanelLayout();
        });

        setTimeout(function() {
            const panel = getSettingsPanel();
            if (!panel) {
                return;
            }

            const observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    if (mutation.attributeName === 'class' && panel.classList.contains('open')) {
                        syncSettingsPanelLayout();
                        const fileName = getSelectedEditorFile();
                        if (fileName) {
                            loadStrategyCode({ forceReload: true, fileName });
                        }
                    } else if (mutation.attributeName === 'class' && !panel.classList.contains('open')) {
                        Object.keys(FLOATING_PANEL_DEFAULTS).forEach(function(type) {
                            setFloatingEditorOpen(type, false);
                        });
                        setInlineCodeOpen(false);
                    }
                });
            });

            observer.observe(panel, { attributes: true });
        }, 500);
    });
})();
