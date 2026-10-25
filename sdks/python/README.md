# DocSign Python SDK

Standard library only (Python 3.9+).

```python
from docsign import DocSign, verify_webhook

ds = DocSign(api_key="dsk_test_...", base_url="https://app.example.com")
env = ds.envelopes.create(title="Offer letter", jurisdiction="IN")
doc = ds.envelopes.upload_document(env["id"], open("offer.pdf", "rb").read(), "offer.pdf")
env = ds.envelopes.set_recipients(env["id"], [{"name": "Priya Shah", "email": "priya@example.com", "locale": "hi"}])
ds.envelopes.set_fields(env["id"], [{
    "documentId": doc["id"], "recipientId": env["recipients"][0]["id"],
    "type": "SIGNATURE", "page": 0, "x": 0.1, "y": 0.8, "width": 0.3, "height": 0.06,
}])
ds.envelopes.send(env["id"])

# In your webhook handler (raw body, not re-serialised JSON):
event = verify_webhook(request_body, headers["X-DocSign-Signature"], webhook_secret)
```

Errors raise `DocSignError` with `.status`, `.code` and `.details`.
