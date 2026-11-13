Pure, idempotent nodes run optimistically everywhere and merge as a CRDT. Non-idempotent side-effect nodes must hold a lease from a quorum and carry a monotonic fencing token; the side-effect endpoint rejects lower tokens. No central coordinator: leases are granted by a majority of reachable peers.

State machine: PENDING -> CLAIMED -> RUNNING -> COMMITTED; RUNNING -> ABANDONED on partition (lease expiry); ABANDONED -> PENDING.

struct ClaimRequest { node_id: u64, task_id: u64, token: u64 }
struct LeaseGrant { task_id: u64, token: u64, expires_ms: u64 }
