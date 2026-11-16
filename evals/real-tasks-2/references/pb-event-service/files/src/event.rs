#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EventType {
    Metric,
    Alert,
    Audit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Event {
    pub id: u64,
    pub event_type: EventType,
    pub severity: u8,
    pub payload: String,
}

impl Event {
    pub fn new(id: u64, event_type: EventType, severity: u8, payload: impl Into<String>) -> Self {
        Self {
            id,
            event_type,
            severity,
            payload: payload.into(),
        }
    }

    pub fn parse_csv_line(line: &str) -> Result<Self, String> {
        let parts: Vec<&str> = line.trim().splitn(4, ',').collect();
        if parts.len() < 4 {
            return Err("Invalid CSV line format: expected 4 comma-separated values".into());
        }
        let id = parts[0].parse::<u64>().map_err(|e| e.to_string())?;
        let event_type = match parts[1] {
            "Metric" => EventType::Metric,
            "Alert" => EventType::Alert,
            "Audit" => EventType::Audit,
            other => return Err(format!("Unknown event type: {}", other)),
        };
        let severity = parts[2].parse::<u8>().map_err(|e| e.to_string())?;
        let payload = parts[3].to_string();
        Ok(Self {
            id,
            event_type,
            severity,
            payload,
        })
    }
}
