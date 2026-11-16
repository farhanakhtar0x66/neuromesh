The sensor fusion crate does not build, and two functions are wrong. Fix them and make the crate compile.

- `src/lib.rs` carries a strict lint policy (`#![deny(...)]`) that the file violates; keep the policy and make the code comply.
- `SensorReading::decode_telemetry_frame` (`src/sensor.rs`) parses frames of the form `id:kind:value:timestamp`, for example `7:RAD:0.25:1700000500`, where kind is `TEMP`, `VIB` or `RAD`; it takes the value from the wrong field and rejects ordinary frames.
- `TelemetryAggregator::filter_anomalies` (`src/aggregator.rs`) currently returns an empty list. It should return references to the recorded readings whose value is above `anomaly_threshold`, in the order they were recorded; when `target_kind` is `Some(kind)` only readings of that kind count, and when it is `None` every kind does.
