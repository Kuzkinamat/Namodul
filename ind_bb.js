function calculateBollingerBands(data, period = 20, stdDev = 2) {
    if (!data || !data.length || data.length < period) {
        return data.map(d => ({ time: d.time, upper: null, middle: null, lower: null }));
    }

    const bb = [];
    let sum = 0, sumOfSquares = 0;
    
    // Initialization for the first window
    for (let i = 0; i < period; i++) {
        const val = data[i].close;
        sum += val;
        sumOfSquares += val * val;
    }
    
    // Set first period-1 values to null
    for (let i = 0; i < period - 1; i++) {
        bb.push({ time: data[i].time, upper: null, middle: null, lower: null });
    }
    
    // Sliding window for remaining values
    for (let i = period - 1; i < data.length; i++) {
        if (i > period - 1) {
            // Remove the oldest element from the window
            const oldVal = data[i - period].close;
            sum -= oldVal;
            sumOfSquares -= oldVal * oldVal;
            
            // Add new element to the window
            const newVal = data[i].close;
            sum += newVal;
            sumOfSquares += newVal * newVal;
        }
        
        const mean = sum / period;
        const variance = (sumOfSquares / period) - (mean * mean);
        const std = Math.sqrt(Math.max(0, variance)); // Math.max to guard against numerical errors

        bb.push({
            time: data[i].time,
            upper: mean + stdDev * std,
            middle: mean,
            lower: mean - stdDev * std
        });
    }
    
    return bb;
}

window.calcBB = calculateBollingerBands;
