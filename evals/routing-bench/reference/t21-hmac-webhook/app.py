import hashlib
import hmac
import os

from fastapi import FastAPI, HTTPException, Request

app = FastAPI()
SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")


@app.post("/webhooks/payment")
async def payment_webhook(request: Request):
    body = await request.body()
    signature = request.headers.get("X-Signature", "")
    expected = hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
    if not SECRET or not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=400, detail="invalid signature")
    return {"status": "ok"}
