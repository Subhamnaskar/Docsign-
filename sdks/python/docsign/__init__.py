"""DocSign API client.

    from docsign import DocSign
    ds = DocSign(api_key=os.environ["DOCSIGN_API_KEY"], base_url="https://app.example.com")
    env = ds.envelopes.create(title="Offer letter")
    ds.envelopes.upload_document(env["id"], open("offer.pdf", "rb").read(), "offer.pdf")

Keys starting ``dsk_test_`` create watermarked test agreements that are not billed.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from typing import Any, Optional
from urllib import error, parse, request

__all__ = ["DocSign", "DocSignError", "verify_webhook"]
__version__ = "1.0.0"


class DocSignError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.details = details


class _Section:
    def __init__(self, client: "DocSign"):
        self._c = client


class _Envelopes(_Section):
    def list(self, **query: Any) -> dict:
        qs = parse.urlencode({k: v for k, v in query.items() if v is not None})
        return self._c.request("GET", "/envelopes" + ("?" + qs if qs else ""))

    def create(self, title: str, **fields: Any) -> dict:
        return self._c.request("POST", "/envelopes", {"title": title, **fields})

    def get(self, envelope_id: str) -> dict:
        return self._c.request("GET", f"/envelopes/{envelope_id}")

    def update(self, envelope_id: str, **fields: Any) -> dict:
        return self._c.request("PATCH", f"/envelopes/{envelope_id}", fields)

    def delete(self, envelope_id: str) -> None:
        self._c.request("DELETE", f"/envelopes/{envelope_id}")

    def upload_document(self, envelope_id: str, data: bytes, filename: str) -> dict:
        """Upload a file (PDF, Word, Excel, PowerPoint, ODT, RTF, TXT; up to 25 MB)."""
        return self._c.request("POST", f"/envelopes/{envelope_id}/documents", files={"file": (filename, data)})

    def set_recipients(self, envelope_id: str, recipients: list) -> dict:
        return self._c.request("PUT", f"/envelopes/{envelope_id}/recipients", recipients)

    def set_fields(self, envelope_id: str, fields: list) -> dict:
        return self._c.request("PUT", f"/envelopes/{envelope_id}/fields", fields)

    def send(self, envelope_id: str) -> dict:
        return self._c.request("POST", f"/envelopes/{envelope_id}/send")

    def remind(self, envelope_id: str) -> dict:
        return self._c.request("POST", f"/envelopes/{envelope_id}/remind")

    def void(self, envelope_id: str, reason: str) -> dict:
        return self._c.request("POST", f"/envelopes/{envelope_id}/void", {"reason": reason})

    def audit(self, envelope_id: str) -> dict:
        return self._c.request("GET", f"/envelopes/{envelope_id}/audit")

    def download_document(self, envelope_id: str, document_id: str, original: bool = False) -> bytes:
        suffix = "?version=original" if original else ""
        return self._c.request("GET", f"/envelopes/{envelope_id}/documents/{document_id}/file{suffix}", raw=True)

    def download_certificate(self, envelope_id: str) -> bytes:
        return self._c.request("GET", f"/envelopes/{envelope_id}/certificate", raw=True)

    def embedded_signing_url(self, envelope_id: str, recipient_id: str, return_url: Optional[str] = None) -> dict:
        body = {"returnUrl": return_url} if return_url else {}
        return self._c.request("POST", f"/envelopes/{envelope_id}/recipients/{recipient_id}/embedded-session", body)


class _Templates(_Section):
    def list(self) -> list:
        return self._c.request("GET", "/templates")

    def create_envelope(self, template_id: str, recipients: list, send: bool = False, **fields: Any) -> dict:
        return self._c.request("POST", f"/templates/{template_id}/envelopes", {"recipients": recipients, "send": send, **fields})


class _DocTemplates(_Section):
    def list(self) -> list:
        return self._c.request("GET", "/doc-templates")

    def generate(self, template_id: str, data: dict, envelope_id: Optional[str] = None, title: Optional[str] = None) -> dict:
        body: dict = {"data": data}
        if envelope_id:
            body["envelopeId"] = envelope_id
        if title:
            body["title"] = title
        return self._c.request("POST", f"/doc-templates/{template_id}/generate", body)


class _Webhooks(_Section):
    def create(self, url: str, events: Optional[list] = None) -> dict:
        return self._c.request("POST", "/webhooks", {"url": url, "events": events or []})

    def delete(self, webhook_id: str) -> None:
        self._c.request("DELETE", f"/webhooks/{webhook_id}")


class DocSign:
    def __init__(self, api_key: str, base_url: str, timeout: float = 30.0):
        if not api_key:
            raise ValueError("api_key is required")
        self._key = api_key
        self._base = base_url.rstrip("/") + "/api/v1"
        self._timeout = timeout
        self.envelopes = _Envelopes(self)
        self.templates = _Templates(self)
        self.doc_templates = _DocTemplates(self)
        self.webhooks = _Webhooks(self)

    @property
    def test_mode(self) -> bool:
        return self._key.startswith("dsk_test_")

    def request(self, method: str, path: str, body: Any = None, files: Optional[dict] = None, raw: bool = False) -> Any:
        headers = {"Authorization": "Bearer " + self._key, "User-Agent": "docsign-python/" + __version__}
        data: Optional[bytes] = None
        if files:
            boundary = uuid.uuid4().hex
            chunks = []
            for name, (filename, content) in files.items():
                head = (
                    "--" + boundary + "\r\n"
                    + 'Content-Disposition: form-data; name="' + name + '"; filename="' + filename + '"\r\n'
                    + "Content-Type: application/octet-stream\r\n\r\n"
                )
                chunks += [head.encode(), content, b"\r\n"]
            chunks.append(("--" + boundary + "--\r\n").encode())
            data = b"".join(chunks)
            headers["Content-Type"] = "multipart/form-data; boundary=" + boundary
        elif body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        req = request.Request(self._base + path, data=data, method=method, headers=headers)
        try:
            with request.urlopen(req, timeout=self._timeout) as res:
                payload = res.read()
                if raw:
                    return payload
                return json.loads(payload) if payload else None
        except error.HTTPError as e:
            try:
                err = json.loads(e.read()).get("error", {})
            except Exception:
                err = {}
            raise DocSignError(e.code, err.get("code", "http_error"), err.get("message", "HTTP %d" % e.code), err.get("details")) from None


def verify_webhook(raw_body, header: Optional[str], secret: str, tolerance: int = 300) -> dict:
    """Verify ``X-DocSign-Signature`` (t=<unix>,v1=<hex HMAC-SHA256 of "t.body">) and return the event.

    Pass the raw request body exactly as received.
    """
    body = raw_body.decode() if isinstance(raw_body, bytes) else raw_body
    parts = dict(p.split("=", 1) for p in (header or "").split(",") if "=" in p)
    try:
        ts = int(parts.get("t", ""))
    except ValueError:
        raise DocSignError(400, "bad_signature", "Missing or malformed signature header") from None
    if abs(time.time() - ts) > tolerance:
        raise DocSignError(400, "stale_signature", "Signature timestamp is too old")
    expected = hmac.new(secret.encode(), (str(ts) + "." + body).encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, parts.get("v1", "")):
        raise DocSignError(400, "bad_signature", "Signature does not match")
    return json.loads(body)
