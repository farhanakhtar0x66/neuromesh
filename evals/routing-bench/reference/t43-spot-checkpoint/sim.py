import math, random
random.seed(1)
for lam, price in [(0.05, 2.4), (0.15, 1.1), (0.3, 0.55)]:
    tau = math.sqrt(2 * 0.2 / lam)
    print(f"lambda={lam} tau*={tau:.2f}h price={price}")
