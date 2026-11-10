/// Compare two texts line by line and return a unified diff without file headers.
pub fn unified_diff(old: &str, new: &str, context: usize) -> String {
    let _ = (old, new, context);
    todo!("produce a unified diff")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_texts_have_no_diff() {
        assert_eq!(unified_diff("a\nb\n", "a\nb\n", 3), "");
    }
}
