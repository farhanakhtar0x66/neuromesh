import threading


class TaskFairRWLock:
    """Writer-preferring read-write lock with re-entrant reads and a single pending upgrade."""

    def __init__(self):
        self._cond = threading.Condition(threading.Lock())
        self._readers = {}  # thread id -> how many read acquisitions it holds
        self._writer = None
        self._writers_waiting = 0
        self._upgrader = None

    def acquire_read(self):
        me = threading.get_ident()
        with self._cond:
            if me in self._readers:  # re-entrant: allowed even while a writer waits
                self._readers[me] += 1
                return
            while self._writer is not None or self._writers_waiting > 0 or self._upgrader is not None:
                self._cond.wait()
            self._readers[me] = 1

    def release_read(self):
        me = threading.get_ident()
        with self._cond:
            if me not in self._readers:
                raise RuntimeError("release_read without a read lock")
            self._readers[me] -= 1
            if self._readers[me] == 0:
                del self._readers[me]
            self._cond.notify_all()

    def acquire_write(self):
        me = threading.get_ident()
        with self._cond:
            self._writers_waiting += 1
            try:
                while self._writer is not None or self._readers or self._upgrader is not None:
                    self._cond.wait()
            finally:
                self._writers_waiting -= 1
            self._writer = me

    def release_write(self):
        with self._cond:
            if self._writer != threading.get_ident():
                raise RuntimeError("release_write by a thread that is not the writer")
            self._writer = None
            self._cond.notify_all()

    def upgrade(self):
        me = threading.get_ident()
        with self._cond:
            if me not in self._readers:
                raise RuntimeError("upgrade without a read lock")
            if self._upgrader is not None:
                raise RuntimeError("Concurrent upgrade deadlock")
            self._upgrader = me
            while set(self._readers) != {me}:
                self._cond.wait()
            del self._readers[me]
            self._upgrader = None
            self._writer = me
            self._cond.notify_all()
