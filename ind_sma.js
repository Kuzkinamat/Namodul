function calculateSMA(data, period) {
    if (!data || !data.length || data.length < period) {
        return data.map(d => ({ time: d.time, value: null }));
    }

    const sma = [];
    let sum = 0;
    
    // Initialization for the first window
    for (let i = 0; i < period; i++) {
        const value = data[i].close !== undefined ? data[i].close : data[i].value;
        sum += value;
    }
    
    // Set the first period-1 values to null
    for (let i = 0; i < period - 1; i++) {
        sma.push({ time: data[i].time, value: null });
    }
    
    // Sliding window for remaining values
    for (let i = period - 1; i < data.length; i++) {
        if (i > period - 1) {
            // Remove the oldest element from the window
            const oldValue = data[i - period].close !== undefined ? data[i - period].close : data[i - period].value;
            sum -= oldValue;
            
            // Add new element to the window
            const newValue = data[i].close !== undefined ? data[i].close : data[i].value;
            sum += newValue;
        }
        
        sma.push({ time: data[i].time, value: sum / period });
    }
    
    return sma;
}

window.calcSMA = calculateSMA;
