strip the git merge conflict markers from this config block, keep the incoming (bottom) side whenever there is a conflict, deduplicate keys keeping the last value, and output ONLY a valid JSON object mapping key strings to integer values (save to out.json if writing a file):
<<<<<<< HEAD
MAX_WORKERS=4
TIMEOUT_MS=3000
=======
MAX_WORKERS=12
TIMEOUT_MS=5000
>>>>>>> feat/scale
RETRY_CAP=3
MAX_WORKERS=16
<<<<<<< HEAD
PORT=8080
=======
PORT=9090
>>>>>>> feat/scale
