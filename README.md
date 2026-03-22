# BO strategy tester / trading signal bot

A web application for testing binary options (BO) trading strategies using the Lightweight Charts library v5.1.0.

Version 0.2.0
## Features

- Load data from the Twelve Data API
- Load local data from JS files
- Display candlestick charts with indicators (SMA, Bollinger Bands, Stochastic, MACD)
- Backtest strategies on historical data
- Visualize trade signals and balance/equity chart
- Flexible range and timeframe settings
- Strategy code editor

## In development
Apply code from the editor window using the Run button.

## Usage

1. Open `index.html` in your browser.
2. Choose the data range and timeframe.
3. Select the data source:
   - **Twelve Data API** – requires an API key (included in code)
   - **Local JS** – local data converted from CSV files
4. When selecting a source, the pair list updates and is filtered according to the selected timeframe.
5. Select a currency pair.
6. Selecting a pair loads data from the chosen source respecting the selected range.
7. Enable indicators and strategies via the menu.
8. Run the strategy backtest.
9. Modify indicator parameters in the strategy editor and click Apply to redraw indicators.
10. Modify the strategy code and click Run.

## Automatic loading
## Local data (ES modules)
The app dynamically loads data via ES modules. Data files must be ES modules that export the candlestick array as the default export.

When the app starts and local JS data files are detected (for example, `EURUSD_M5_data.js`, `CADCHF_M5_data.js`), the app will automatically:
- Scan available modules
- Set the source to **Local JS**
- Select the appropriate timeframe (derived from the filename)
- Load the data and display the chart

## Project structure

- `index.html` – main UI
- `main.js` – application logic, chart control, data providers
- `prov-twelvedata.js` – Twelve Data API provider
- `ind.js` – indicator calculations (Stochastic, MACD, EMA)
- `strategy-core.js` – editable strategy code
- `strategy.js` – strategy orchestration and UI glue
- `csv-to-js.js` – CSV-to-JS converter script
- `EURUSD_M5_data.js` – converted data example
- `lightweight-charts.standalone.production.js` – charting library (external)

## Dependencies

- Lightweight Charts v5.1.0 (included)
- A modern browser with ES6 support

## Notes

- The Twelve Data API has rate limits. The free tier allows about 800 requests per day.
- Local data does not require an internet connection and is suitable for testing large historical periods.
- All indicator calculations are performed client-side.

# CSV to JS converter - `csv-to-js.js`
### CSV format
YYYY-MM-DD HH:MM,open,high,low,close,volume
Example:
2025-06-30 22:15,1.17841,1.17874,1.17834,1.17871,181
### Conversion
1. Place your CSV file(s) into the project root directory.
2. Run the script:
   node csv-to-js.js
3. The script will create JS files with the `_data.js` suffix in ES module format (default export). These files do not need to be included in `index.html` with a `<script>` tag because they are loaded dynamically when Local JS is selected as the data source.
