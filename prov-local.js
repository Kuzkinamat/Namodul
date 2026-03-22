// prov-local.js
// Local Data Provider (загрузка данных из ES-модулей)

window.LocalJsProvider = {
    // Кэш загруженных модулей: { [modulePath]: { pair, timeframe, data } }
    _moduleCache: {},

    // Динамический список модулей, полученный сканированием папки data
    _knownModules: null, // будет заполнен при первом сканировании

    /**
     * Загружает модуль по пути и возвращает данные.
     * Использует динамический import().
     */
    async _loadModule(modulePath) {
        if (this._moduleCache[modulePath]) {
            return this._moduleCache[modulePath];
        }
        await this._ensureKnownModules();
        try {
            const module = await import(modulePath);
            // Ожидаем, что модуль экспортирует default как массив свечей
            const data = module.default;
            if (!Array.isArray(data)) {
                throw new Error(`Модуль ${modulePath} не экспортирует массив данных (тип: ${typeof data})`);
            }
            // Найти пару и таймфрейм из известных или извлечь из имени файла
            const known = this._knownModules.find(m => m.path === modulePath);
            let pair = known ? known.pair : '';
            let timeframe = known ? known.timeframe : '1m';
            if (!pair) {
                // Извлечь из имени файла (например, EURUSD_M5_data.js)
                const basename = modulePath.split('/').pop().replace('_data.js', '');
                pair = this._extractPair(basename);
                timeframe = this._extractTimeframe(basename);
            }
            const cached = { pair, timeframe, data };
            this._moduleCache[modulePath] = cached;
            return cached;
        } catch (importErr) {
            console.warn('Dynamic import failed, falling back to global variable:', importErr.message);
            // Попробовать получить данные из глобальной переменной (для обратной совместимости)
            const basename = modulePath.split('/').pop().replace('_data.js', '');
            const globalVarName = basename + '_data';
            if (window[globalVarName] && Array.isArray(window[globalVarName])) {
                addLog(`Используются глобальные данные из ${globalVarName}`);
                const data = window[globalVarName];
                const known = this._knownModules.find(m => m.path === modulePath);
                let pair = known ? known.pair : '';
                let timeframe = known ? known.timeframe : '1m';
                if (!pair) {
                    pair = this._extractPair(basename);
                    timeframe = this._extractTimeframe(basename);
                }
                const cached = { pair, timeframe, data };
                this._moduleCache[modulePath] = cached;
                return cached;
            }
            addLog(`Ошибка загрузки модуля ${modulePath}: ${importErr.message}`);
            throw importErr;
        }
    },

    /**
     * Извлекает пару из базового имени (например, EURUSD_M5 -> EUR/USD)
     */
    _extractPair(basename) {
        // Удалить суффикс таймфрейма
        const withoutTF = basename.replace(/_[MHDW]\d+$/, '');
        if (withoutTF.length === 6 && !withoutTF.includes('/')) {
            return withoutTF.slice(0,3) + '/' + withoutTF.slice(3);
        }
        return withoutTF;
    },

    /**
     * Извлекает таймфрейм из базового имени (например, EURUSD_M5 -> 5m)
     */
    _extractTimeframe(basename) {
        const tfMatch = basename.match(/_([MHDW])(\d+)$/);
        if (tfMatch) {
            const type = tfMatch[1];
            const num = parseInt(tfMatch[2]);
            if (type === 'M') return num + 'm';
            else if (type === 'H') return num + 'H';
            else if (type === 'D') return num + 'D';
            else if (type === 'W') return num + 'W';
            else if (type === 'MN') return num + 'M';
        }
        return '1m';
    },

    /**
     * Сканирует папку data через fetch (листинг директорий) или загружает index.json.
     * Возвращает массив объектов { path, pair, timeframe }.
     */
    async _scanDataFolder() {
        // Пробуем загрузить index.json
        try {
            const response = await fetch('data/index.json', { cache: 'no-store' });
            if (response.ok) {
                const index = await response.json();
                // Ожидаем массив объектов с полями filename, pair, timeframe
                // или просто массив имён файлов.
                if (Array.isArray(index)) {
                    const modules = index.map(item => {
                        if (typeof item === 'string') {
                            const basename = item.replace('_data.js', '');
                            return {
                                path: './data/' + item,
                                pair: this._extractPair(basename),
                                timeframe: this._extractTimeframe(basename)
                            };
                        } else {
                            // Уже объект
                            return {
                                path: './data/' + item.filename,
                                pair: item.pair || this._extractPair(item.filename.replace('_data.js', '')),
                                timeframe: item.timeframe || this._extractTimeframe(item.filename.replace('_data.js', ''))
                            };
                        }
                    });
                    addLog(`Index manifest loaded: ${modules.length} data files.`);
                    return modules;
                }
                addLog('Index manifest is not an array, trying directory listing.');
            }
            addLog(`Index manifest unavailable (HTTP ${response.status}), trying directory listing.`);
        } catch (e) {
            // index.json не найден или ошибка сети
            console.warn('Не удалось загрузить data/index.json:', e.message);
            addLog(`Index manifest failed: ${e.message}`);
        }

        // Пробуем получить листинг директории data/
        try {
            const response = await fetch('data/', { cache: 'no-store' });
            if (response.ok) {
                const html = await response.text();
                console.log('HTML листинга data/ (первые 2000 символов):', html.substring(0, 2000));
                // Парсим HTML листинга (простой regex для ссылок на файлы)
                const matches = [...html.matchAll(/href\s*=\s*["']([^"']*_data\.js(?:\?[^"']*)?)["']/gi)];
                if (matches) {
                    const files = matches.map(m => m[1]);
                    console.log('Все ссылки на _data.js:', files);
                    // Фильтруем только файлы _data.js
                    const dataFiles = [...new Set(files
                        .map(f => f.split('?')[0])
                        .map(f => f.split('/').pop())
                        .filter(f => f && f.endsWith('_data.js'))
                    )];
                    console.log('Отфильтрованные файлы данных:', dataFiles);
                    const modules = dataFiles.map(filename => {
                        const basename = filename.replace('_data.js', '');
                        return {
                            path: './data/' + filename,
                            pair: this._extractPair(basename),
                            timeframe: this._extractTimeframe(basename)
                        };
                    });
                    console.log('Сформированные модули:', modules);
                    if (modules.length > 0) {
                        addLog(`Directory listing loaded: ${modules.length} data files.`);
                        return modules;
                    }
                    addLog('Directory listing parsed but no data files found.');
                } else {
                    console.warn('Не найдено ссылок на _data.js в HTML листинга');
                    addLog('Directory listing has no links to *_data.js files.');
                }
            } else {
                console.warn('Ответ от data/ не OK:', response.status, response.statusText);
                addLog(`Directory listing unavailable (HTTP ${response.status}).`);
            }
        } catch (e) {
            console.warn('Не удалось получить листинг папки data:', e.message);
            addLog(`Directory listing failed: ${e.message}`);
        }

        // Если ничего не получилось, возвращаем пустой массив.
        console.warn('Динамическое сканирование не удалось. Файлы локальных данных не найдены.');
        return [];
    },

    /**
     * Обеспечивает, что _knownModules заполнен.
     */
    async _ensureKnownModules() {
        if (this._knownModules === null) {
            this._knownModules = await this._scanDataFolder();
            addLog(`Сканирование папки data: найдено ${this._knownModules.length} файлов данных.`);
        }
    },

    /**
     * Возвращает метаданные всех известных модулей без загрузки массивов свечей.
     * Это важно для быстрого старта: тяжелые модули подгружаются только в fetchData.
     */
    async scanModules() {
        await this._ensureKnownModules();
        return this._knownModules.map(mod => ({
            variable: mod.path,
            path: mod.path,
            pair: mod.pair,
            timeframe: mod.timeframe
        }));
    },

    /**
     * Получить список доступных торговых пар (уникальные)
     */
    async getPairs() {
        await this._ensureKnownModules();
        const pairs = [...new Set(this._knownModules.map(d => d.pair))];
        return pairs;
    },

    /**
     * Получить пары, отфильтрованные по таймфрейму (если таймфрейм выбран)
     */
    async getPairsByTimeframe(timeframe) {
        await this._ensureKnownModules();
        const filtered = this._knownModules.filter(d => d.timeframe === timeframe);
        addLog(`Фильтрация по TF ${timeframe}: найдено ${filtered.length} наборов данных`);
        return filtered.map(d => d.pair);
    },

    /**
     * Запрос доступа (всегда успешен для локальных данных)
     */
    async requestAccess() {
        addLog("Local data provider initialized (ES modules).");
        await this._ensureKnownModules();
        addLog(`Доступно файлов данных: ${this._knownModules.length}`);
        return true;
    },

    /**
     * Загрузить данные для конкретной пары, таймфрейма и диапазона.
     * Возвращает последние N свечей, где N = DataUtils.calculateOutputSize(range, timeframe).
     */
    async fetchData(range, timeframe, pair) {
        addLog(`Loading local data: ${pair}, Timeframe: ${timeframe}, Range: ${range}`);
        await this._ensureKnownModules();
        const targetMeta = this._knownModules.find(d => d.pair === pair && d.timeframe === timeframe);
        if (!targetMeta) {
            addLog(`No data for ${pair} - ${timeframe}`);
            throw new Error(`No local data found for ${pair} (TF: ${timeframe})`);
        }

        const dataset = await this._loadModule(targetMeta.path);
        // Вычислить, сколько свечей нужно на основе диапазона и таймфрейма
        const outputSize = window.DataUtils.calculateOutputSize(range, timeframe);
        // Вернуть последние 'outputSize' свечей (или все, если набор меньше)
        const sliceStart = Math.max(0, dataset.data.length - outputSize);
        const slicedData = dataset.data.slice(sliceStart);
        addLog(`Local data sliced: ${dataset.data.length} -> ${slicedData.length} candles (Range: ${range})`);
        // Вернуть копию, чтобы избежать мутаций
        return slicedData.slice();
    }
};