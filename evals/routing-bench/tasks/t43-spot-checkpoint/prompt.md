we run 3 cloud GPU spot instances with different eviction probabilities (p1=0.05/hr, p2=0.15/hr, p3=0.30/hr) and hourly costs ($2.40, $1.10, $0.55). checkpointing a 14-hour training job takes 12 minutes and costs $0.10 in I/O. derive the optimal dynamic checkpointing interval and instance selection policy that minimizes expected total cost to completion, then write a python simulator to verify it

Write the derivation to ANSWER.md and the simulator to sim.py (it must run with python3 sim.py, standard library only, in under a minute).
