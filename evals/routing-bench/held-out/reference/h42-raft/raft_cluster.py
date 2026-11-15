import random

FOLLOWER, CANDIDATE, LEADER = "follower", "candidate", "leader"
HEARTBEAT = 3


class _Node:
    def __init__(self, nid, deadline):
        self.id = nid
        self.term = 0
        self.voted_for = None
        self.log = []  # (term, cmd); index i of the Raft log is self.log[i - 1]
        self.commit_index = 0
        self.role = FOLLOWER
        self.deadline = deadline
        self.votes = set()
        self.next_index = {}
        self.match_index = {}
        self.next_beat = 0

    def last(self):
        return (len(self.log), self.log[-1][0] if self.log else 0)


class RaftCluster:
    def __init__(self, num_nodes, seed=42):
        self.n = num_nodes
        self.rng = random.Random(seed)
        self.now = 0
        self.nodes = [_Node(i, self._timeout()) for i in range(num_nodes)]
        self.queue = []  # (deliver_at, order, src, dst, message)
        self.order = 0
        self.blocked = set()  # frozenset({a, b}) pairs that cannot talk
        self.isolated = set()

    def _timeout(self):
        return self.now + self.rng.randint(10, 20)

    # ---- network ----
    def _up(self, a, b):
        return a not in self.isolated and b not in self.isolated and frozenset((a, b)) not in self.blocked

    def partition(self, group_a, group_b):
        for a in group_a:
            for b in group_b:
                self.blocked.add(frozenset((a, b)))

    def isolate(self, node_id):
        self.isolated.add(node_id)

    def heal(self):
        self.blocked.clear()
        self.isolated.clear()

    def _send(self, src, dst, msg):
        if self._up(src, dst):
            self.order += 1
            self.queue.append((self.now + 1, self.order, src, dst, msg))

    # ---- time ----
    def step(self, ticks=1):
        for _ in range(ticks):
            self.now += 1
            due = sorted(m for m in self.queue if m[0] <= self.now)
            self.queue = [m for m in self.queue if m[0] > self.now]
            for _, _, src, dst, msg in due:
                if self._up(src, dst):  # a message in flight when a link goes down is lost
                    self._receive(self.nodes[dst], src, msg)
            for node in self.nodes:
                if node.role == LEADER:
                    if self.now >= node.next_beat:
                        self._replicate(node)
                elif self.now >= node.deadline:
                    self._election(node)

    # ---- elections ----
    def _election(self, node):
        node.term += 1
        node.role = CANDIDATE
        node.voted_for = node.id
        node.votes = {node.id}
        node.deadline = self._timeout()
        idx, term = node.last()
        for peer in range(self.n):
            if peer != node.id:
                self._send(node.id, peer, ("vote?", node.term, idx, term))
        self._maybe_win(node)

    def _maybe_win(self, node):
        if node.role == CANDIDATE and len(node.votes) * 2 > self.n:
            node.role = LEADER
            idx = len(node.log)
            node.next_index = {p: idx + 1 for p in range(self.n)}
            node.match_index = {p: 0 for p in range(self.n)}
            self._replicate(node)  # no no-op entry: the leader appends nothing of its own

    def _step_down(self, node, term):
        node.term = term
        node.voted_for = None
        node.role = FOLLOWER
        node.votes = set()

    # ---- messages ----
    def _receive(self, node, src, msg):
        kind, term = msg[0], msg[1]
        if term > node.term:
            self._step_down(node, term)
        if kind == "vote?":
            _, _, c_idx, c_term = msg
            my_idx, my_term = node.last()
            fresh = c_term > my_term or (c_term == my_term and c_idx >= my_idx)
            grant = term == node.term and node.voted_for in (None, src) and fresh
            if grant:
                node.voted_for = src
                node.deadline = self._timeout()
            self._send(node.id, src, ("vote!", node.term, grant))
        elif kind == "vote!":
            if node.role == CANDIDATE and term == node.term and msg[2]:
                node.votes.add(src)
                self._maybe_win(node)
        elif kind == "append?":
            _, _, prev_idx, prev_term, entries, leader_commit = msg
            if term < node.term:
                self._send(node.id, src, ("append!", node.term, False, 0))
                return
            node.role = FOLLOWER
            node.deadline = self._timeout()
            if prev_idx > len(node.log) or (prev_idx > 0 and node.log[prev_idx - 1][0] != prev_term):
                self._send(node.id, src, ("append!", node.term, False, 0))
                return
            for k, entry in enumerate(entries):
                at = prev_idx + k  # 0-based position in the log
                if at < len(node.log) and node.log[at][0] != entry[0]:
                    del node.log[at:]  # conflict: drop it and everything after
                if at >= len(node.log):
                    node.log.append(entry)
            last_new = prev_idx + len(entries)
            if leader_commit > node.commit_index:
                node.commit_index = min(leader_commit, last_new)
            self._send(node.id, src, ("append!", node.term, True, last_new))
        elif kind == "append!":
            if node.role != LEADER or term != node.term:
                return
            if msg[2]:
                node.match_index[src] = max(node.match_index[src], msg[3])
                node.next_index[src] = node.match_index[src] + 1
                self._advance_commit(node)
            else:
                node.next_index[src] = max(1, node.next_index[src] - 1)
                self._send_append(node, src)

    def _send_append(self, node, peer):
        nxt = node.next_index[peer]
        prev_idx = nxt - 1
        prev_term = node.log[prev_idx - 1][0] if prev_idx > 0 else 0
        self._send(node.id, peer, ("append?", node.term, prev_idx, prev_term, list(node.log[prev_idx:]), node.commit_index))

    def _replicate(self, node):
        node.next_beat = self.now + HEARTBEAT
        for peer in range(self.n):
            if peer != node.id:
                self._send_append(node, peer)

    def _advance_commit(self, node):
        for idx in range(len(node.log), node.commit_index, -1):
            # Figure 8: only an entry from the leader's own term is committed by counting replicas.
            # Older entries commit with it, indirectly.
            if node.log[idx - 1][0] != node.term:
                break
            copies = 1 + sum(1 for p in range(self.n) if p != node.id and node.match_index[p] >= idx)
            if copies * 2 > self.n:
                node.commit_index = idx
                break

    # ---- public queries and commands ----
    def leader(self):
        best = None
        for node in self.nodes:
            if node.role != LEADER:
                continue
            reach = sum(1 for p in range(self.n) if p == node.id or self._up(node.id, p))
            if reach * 2 > self.n and (best is None or node.term > best.term):
                best = node
        return best.id if best else None

    def propose(self, cmd, node_id=None):
        if node_id is None:
            node_id = self.leader()
            if node_id is None:
                return None
        node = self.nodes[node_id]
        if node.role != LEADER:
            return None
        node.log.append((node.term, cmd))
        return (True, len(node.log), node.term)

    def committed_log(self, node_id):
        node = self.nodes[node_id]
        return list(node.log[:node.commit_index])

    def full_log(self, node_id):
        return list(self.nodes[node_id].log)
