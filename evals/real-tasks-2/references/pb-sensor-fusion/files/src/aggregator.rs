use crate::sensor::{ReadingKind, SensorReading};

#[derive(Debug, Clone)]
pub struct TelemetryAggregator {
    pub anomaly_threshold: f64,
    pub target_kind: Option<ReadingKind>,
    pub readings: Vec<SensorReading>,
}

impl TelemetryAggregator {
    pub fn new(anomaly_threshold: f64, target_kind: Option<ReadingKind>) -> Self {
        Self {
            anomaly_threshold,
            target_kind,
            readings: Vec::new(),
        }
    }

    pub fn record(&mut self, reading: SensorReading) {
        self.readings.push(reading);
    }

    pub fn filter_anomalies(&self) -> Vec<&SensorReading> {
        self.readings
            .iter()
            .filter(|r| r.value > self.anomaly_threshold && self.target_kind.map_or(true, |k| r.kind == k))
            .collect()
    }

    pub fn count(&self) -> usize {
        self.readings.len()
    }
}
