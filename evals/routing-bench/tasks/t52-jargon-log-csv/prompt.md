[14209.881021] kernel: BUG: unable to handle page fault for address: ffffc90001a4e000
[14209.881045] systemd-journald[412]: Failed to flush runtime journal: Cannot allocate memory
[14209.881102] bpf_verifier[1984]: R1 type=map_value_or_null expected=map_value in xdp_ringbuf_submit
[14209.881290] kernel: Call Trace: <IRQ> __xdp_release_frame+0x42/0x90 [mlx5_core] (PID: 1984)
[14210.004112] bgpd[882]: %BGP-3-NOTIFICATION: received from neighbor 10.240.0.11 4/0 (Hold Timer Expired)
[14210.119402] nvme0n1[519]: I/O Cmd(0x2) @ LBA 99481024, 8 blocks, I/O Error (sct 0x0 / sc 0x80)

hey my prod node crashed during an eBPF XDP ringbuf attach, anyways dont debug it yet just pull out every unique timestamp and PID from the log above into a 2-column CSV with headers timestamp,pid

Write the CSV to output.csv.
