#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadingKind {
    Temperature,
    Vibration,
    Radiation,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SensorReading {
    pub sensor_id: u32,
    pub kind: ReadingKind,
    pub value: f64,
    pub timestamp_ms: u64,
}

impl SensorReading {
    pub fn new(sensor_id: u32, kind: ReadingKind, value: f64, timestamp_ms: u64) -> Self {
        Self {
            sensor_id,
            kind,
            value,
            timestamp_ms,
        }
    }

    pub fn decode_telemetry_frame(frame: &str) -> Result<Self, String> {
        // Buggy initial implementation: fails to parse kind correctly and errors on standard frame
        let parts: Vec<&str> = frame.split(':').collect();
        if parts.len() < 4 {
            return Err("Frame must contain 4 fields: id:kind:value:timestamp".to_string());
        }

        let sensor_id = parts[0]
            .parse::<u32>()
            .map_err(|e| format!("Invalid sensor_id: {}", e))?;

        let kind = match parts[1] {
            "TEMP" => ReadingKind::Temperature,
            "VIB" => ReadingKind::Vibration,
            "RAD" => ReadingKind::Radiation,
            _ => return Err(format!("Unknown reading kind: {}", parts[1])),
        };

        let value = parts[2]
            .parse::<f64>()
            .map_err(|e| format!("Invalid telemetry value: {}", e))?;

        let timestamp_ms = parts[3]
            .parse::<u64>()
            .map_err(|e| format!("Invalid timestamp: {}", e))?;

        Ok(Self {
            sensor_id,
            kind,
            value,
            timestamp_ms,
        })
    }
}
