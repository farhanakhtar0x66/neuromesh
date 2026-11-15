import subprocess, sys
sys.exit(subprocess.run(["node", "--no-warnings", "hidden/check.mjs"]).returncode)
