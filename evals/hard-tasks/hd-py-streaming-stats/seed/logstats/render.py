"""The report text (docs/OUTPUT.md)."""

from __future__ import annotations

from .analysis import Stats


def render(stats: Stats) -> str:
    out = [
        "logstats report",
        f"lines: {stats.lines}",
        f"malformed: {stats.malformed}",
        f"requests: {stats.requests}",
    ]
    if stats.requests:
        out.append(f"period: {stats.first} .. {stats.last}")
        out.append(f"bytes: {stats.total_bytes}")
        out.append(f"duration ms: min {stats.min_ms}, max {stats.max_ms}, mean {stats.sum_ms / stats.requests:.1f}")
    else:
        out += ["period: n/a", "bytes: 0", "duration ms: n/a"]
    out.append("status: " + " ".join(f"{c}xx={stats.classes.get(c, 0)}" for c in range(1, 6)))

    out.append("top paths:")
    top = sorted(stats.paths.items(), key=lambda kv: (-kv[1], kv[0]))[:10]
    out += [f"  {path}  {count}" for path, count in top] or ["  (none)"]

    out.append("errors per hour (5xx):")
    for hour in sorted(stats.hours):
        n, errors = stats.hours[hour]
        label = f"{hour[:10]} {hour[11:13]}:00"
        out.append(f"  {label}  {errors}/{n}  {100 * errors / n:.2f}%")
    if not stats.hours:
        out.append("  (none)")

    out.append(f"users: {len(stats.users)}")
    for user in sorted(stats.users):
        n, sessions = stats.users[user]
        out.append(f"  {user}  requests={n} sessions={sessions}")
    if not stats.users:
        out.append("  (none)")
    out.append(f"sessions: total {sum(s for _, s in stats.users.values())}")
    return "\n".join(out) + "\n"
