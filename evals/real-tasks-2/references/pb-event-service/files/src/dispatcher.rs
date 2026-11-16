use crate::event::Event;
use crate::filter::EventFilter;

pub trait EventHandler: Send {
    fn handle(&mut self, event: &Event);
}

pub struct EventDispatcher<'a> {
    filter: Option<&'a EventFilter>,
    handlers: Vec<Box<dyn EventHandler + 'a>>,
    dispatched_count: usize,
}

impl<'a> EventDispatcher<'a> {
    pub fn new() -> Self {
        Self {
            filter: None,
            handlers: Vec::new(),
            dispatched_count: 0,
        }
    }

    pub fn with_filter(mut self, filter: &'a EventFilter) -> Self {
        self.filter = Some(filter);
        self
    }

    pub fn register_handler(&mut self, handler: Box<dyn EventHandler + 'a>) {
        self.handlers.push(handler);
    }

    pub fn dispatched_count(&self) -> usize {
        self.dispatched_count
    }

    pub fn dispatch(&mut self, event: &Event) -> bool {
        let allowed = match self.filter {
            Some(f) => f.evaluate_predicate(event),
            None => true,
        };

        if !allowed {
            return false;
        }

        if self.handlers.is_empty() {
            return false;
        }

        for handler in self.handlers.iter_mut() {
            handler.handle(event);
        }
        self.dispatched_count += 1;
        true
    }
}
