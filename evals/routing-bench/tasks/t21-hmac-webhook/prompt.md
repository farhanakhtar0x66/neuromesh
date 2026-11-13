write a fast python fastapi endpoint for POST /webhooks/payment that takes a razorpay style payload, checks the hmac sha256 signature from the X-Signature header using an env secret, and returns 400 if invalid or 200 ok. keep it clean

Write the code to app.py.
