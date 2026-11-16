pub struct ChunkBuffer {
    data: Vec<u8>,
    capacity: usize,
}

impl ChunkBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            data: Vec::new(),
            capacity,
        }
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<(), String> {
        if self.data.len() + chunk.len() > self.capacity {
            return Err("Buffer capacity exceeded".to_string());
        }
        self.data.extend_from_slice(chunk);
        Ok(())
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }

    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    pub fn drain_all(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.data)
    }
}
