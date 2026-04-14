// strategy-indicator-signals.js
// Calculate indicator crossover signals (e.g., Stochastic K/D crossovers)

window.StrategyIndicatorSignals = (function() {
    'use strict';

    /**
     * Generate crossover signals from Stochastic indicator
     * Strength = max K-D distance over last stochasticD periods
     * Returns array with time and duration info for visualization
     */
    function getStochasticCrossoverSignals(data, stochasticData, params) {
        const signals = [];
        
        if (!Array.isArray(stochasticData) || stochasticData.length < 2) {
            return signals;
        }

        const lookbackPeriods = (params && params.stochasticD) ? Math.max(1, params.stochasticD) : 3;

        for (let i = 1; i < stochasticData.length; i++) {
            const prev = stochasticData[i - 1];
            const curr = stochasticData[i];
            
            // Skip if data is incomplete
            if (!prev || !curr || prev.k === undefined || curr.k === undefined || 
                prev.d === undefined || curr.d === undefined) {
                continue;
            }

            // Detect crossover: K crosses D (either direction)
            const prevCrossing = prev.k - prev.d;
            const currCrossing = curr.k - curr.d;
            
            // True crossover when signs change
            if (Math.sign(prevCrossing) !== Math.sign(currCrossing) && prevCrossing !== 0) {
                if (!data[i]) continue;
                
                // Calculate max K-D distance over last lookbackPeriods candles
                let maxDiff = Math.abs(curr.k - curr.d);
                for (let j = 1; j < lookbackPeriods && i - j >= 0; j++) {
                    const prevData = stochasticData[i - j];
                    if (prevData && prevData.k !== undefined && prevData.d !== undefined) {
                        maxDiff = Math.max(maxDiff, Math.abs(prevData.k - prevData.d));
                    }
                }
                
                // Direction based on crossover direction (from prev to curr)
                // If currCrossing > prevCrossing, K is crossing D upward (buy)
                // If currCrossing < prevCrossing, K is crossing D downward (sell)
                const crossoverDirection = Math.sign(currCrossing - prevCrossing);
                
                signals.push({
                    time: data[i].time,
                    index: i,
                    strength: maxDiff,  // Max distance between K and D
                    direction: crossoverDirection > 0 ? 'up' : 'down' // Direction of crossover
                });
            }
        }

        return signals;
    }

    /**
     * Create line data for signals panel
     * Value: +1 for up, -1 for down, scaled by strength
     * Color based on stochastic K position
     */
    function createSignalLineData(data, signals, stochasticData) {
        const lineData = [];
        const signalMap = {};
        
        // Build map of signals by time for quick lookup
        signals.forEach(signal => {
            signalMap[signal.time] = signal;
        });
        
        // Create line points - one per candle
        data.forEach((candle, idx) => {
            const signal = signalMap[candle.time];
            let value = 0;  // No signal
            let color = '#808080';  // Default gray
            
            if (signal) {
                // Scale strength (0-100) to 0-1 range
                const normalizedStrength = Math.min(1, signal.strength / 100);
                // Direction: +1 for up, -1 for down
                value = signal.direction === 'up' ? normalizedStrength : -normalizedStrength;
                
                // Color based on stochastic K line
                if (stochasticData && stochasticData[idx] && stochasticData[idx].k !== undefined) {
                    const kValue = stochasticData[idx].k;
                    // Color palette aligned with stochastic K levels
                    if (kValue > 70) {
                        color = '#26a69a';  // Strong up
                    } else if (kValue > 50) {
                        color = '#33b2a8';  // Moderate up
                    } else if (kValue < 30) {
                        color = '#ef5350';  // Strong down
                    } else if (kValue < 50) {
                        color = '#f27070';  // Moderate down
                    } else {
                        color = '#808080';  // Neutral at 50
                    }
                }
            }
            
            lineData.push({
                time: candle.time,
                value: value,
                color: color
            });
        });
        
        return lineData;
    }

    return {
        getStochasticCrossoverSignals,
        createSignalLineData
    };
})();
