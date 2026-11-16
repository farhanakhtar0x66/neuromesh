use crate::buffer::ChunkBuffer;

pub struct MemorySink {
    records: Vec<Vec<u8>>,
}

impl MemorySink {
    pub fn new() -> Self {
        Self {
            records: Vec::new(),
        }
    }

    pub fn record_count(&self) -> usize {
        self.records.len()
    }

    pub fn get_record(&self, index: usize) -> Option<&[u8]> {
        self.records.get(index).map(|r| r.as_slice())
    }

    pub fn flush_buffer(&mut self, buffer: &mut ChunkBuffer) -> usize {
        let record = buffer.drain_all();
        let flushed = record.len();
        if flushed > 0 {
            self.records.push(record);
        }
        flushed
    }
}
