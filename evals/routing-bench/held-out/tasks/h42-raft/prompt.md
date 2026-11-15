in a single file `raft_cluster.py` (pure Python 3 stdlib), implement a deterministic discrete-event Raft consensus cluster simulator:
- `class RaftCluster`:
  - `__init__(self, num_nodes: int, seed: int = 42)`
  - `step(self, ticks: int = 1) -> None`
  - `partition(self, group_a: set[int], group_b: set[int]) -> None` (drops all messages between `group_a` and `group_b`)
  - `isolate(self, node_id: int) -> None` (drops all messages to/from `node_id`)
  - `heal(self) -> None` (restores full connectivity)
  - `leader(self) -> int | None` (returns current highest-term active leader in a connected majority, or `None`)
  - `propose(self, cmd: str, node_id: int | None = None) -> tuple[bool, int, int] | None` (appends `cmd` to leader's log and returns `(accepted, index, term)`)
  - `committed_log(self, node_id: int) -> list[tuple[int, str]]` (returns list of `(term, cmd)` up to ` node.commit_index`)
  - `full_log(self, node_id: int) -> list[tuple[int, str]]`
Enforce all Raft safety invariants (randomized election timeouts in `[10, 20]` ticks, `RequestVote` up-to-date log check comparing last log term then length, `AppendEntries` `prevLogIndex`/`prevLogTerm` consistency backoff, and the **Raft Figure 8 Commit Rule**: a leader must NEVER mark log entries from previous terms as committed by counting replicas alone; previous-term entries are only committed indirectly when an entry from the leader's CURRENT term is replicated on a majority).
