# logstats needs to stream: it is killed on our big logs and cannot sit in a pipe

The nightly `logstats` run on our busiest cluster gets OOM-killed now that a day of access log is several million
lines: it reads the whole file into memory, parses every line into a list and sorts it before it counts anything.
We also want to use it the way we use other tools, `zcat access.log.gz | python -m logstats`, and to give it
several files at once (`python -m logstats mon.log tue.log`, read as one log, in the order given).

Please make it a single streaming pass over the lines, reading standard input when there is no file argument (or
the argument `-`) and the named files otherwise, so that memory depends on the number of distinct users and paths
and not on the number of lines. As a target: on a log of two million lines from 2,000 users and 300 paths, arriving
at about ten lines a second, Python's peak memory as measured by `tracemalloc` should stay under 16 MiB.

The report itself must not change in any way: other tools diff it from one day to the next, so the output has to be
identical, character for character, to what the current version prints for the same log.
