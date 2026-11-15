A model that hits its subscription limit is tried again by every later run, which spends a call to find out it is still out. Remember it across runs until its limit resets.

- When a turn stops on quota for a model, record a cooldown for that model in a file `cooldowns.json` in the Neuromesh home folder: a JSON object keyed by "backend/model" (for example "fake/limited"), each value an object with an `until` field holding an ISO date-time. The reset time comes from the message when it gives one ("Resets in 4h55m56s" means 4 hours 55 minutes 56 seconds from now); with none, use 30 minutes from now.
- A later run with the same home skips a model whose cooldown has not passed, as if it had just run out of quota, and emits a `note` event whose message says the model is still out of quota. It must not spend a call on that model.
- Add `clearCooldowns(home: string)` in a new file src/engine/cooldown.ts, which forgets every recorded cooldown for that home. The pause-and-resume test pauses a run on quota and resumes it in the same home, and calls it to pretend the limit has reset (resuming before the reset would only pause again).

Tests are in test/engine.test.ts.
