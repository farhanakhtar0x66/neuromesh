convert these 5 raw syslog lines into a 3-column tab-separated file `out.tsv` (header: TIMESTAMP_UTC	FACILITY_PRI	MESSAGE) with timestamps normalised to UTC Z (YYYY-MM-DDTHH:MM:SSZ) and sorted chronologically oldest first. output raw TSV only:
<165>1 2026-11-14T15:30:00+05:30 edge-01 sshd 412 - - Accepted publickey
<34>1 2026-11-14T08:15:00Z db-02 postgres 881 - - deadlock detected
<131>1 2026-11-14T09:45:00-01:00 gw-01 nginx 109 - - upstream timed out
<14>1 2026-11-14T10:05:00+00:00 cron-01 systemd 1 - - Started daily cleanup
<86>1 2026-11-14T18:00:00+09:00 auth-01 sudo 992 - - pam_unix session opened
