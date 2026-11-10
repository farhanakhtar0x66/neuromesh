"""Parse human durations like 1h30m into seconds."""
import re

_PATTERN = re.compile(r"^(?:(\d+)h)?(?:(\d+)m)?$")


def parse_duration(text):
    match = _PATTERN.match(text.strip())
    if not match:
        raise ValueError(f"bad duration: {text!r}")
    hours, minutes = match.groups()
    total = 0
    if hours:
        total += int(hours) * 3600
    if minutes:
        total += int(minutes) * 3600
    return total
