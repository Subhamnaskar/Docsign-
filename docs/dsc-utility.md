# DSC signing utility protocol

Browsers cannot talk to USB signing tokens directly. When a signer chooses
**Sign with DSC token**, the signing page asks a small utility running on the
signer's computer to sign. Any utility that implements this protocol works:
for example a thin wrapper around an existing Indian DSC signer, or a
purpose-built desktop helper.

The utility is not part of this repository yet.

## Request

The signing page sends:

```
POST http://127.0.0.1:3434/sign
Content-Type: application/json

{
  "signer": "Lender Co",
  "documents": [
    { "documentId": "cm…", "digest": "<hex SHA-256 of the PDF byte ranges>" }
  ]
}
```

Override the address with `NEXT_PUBLIC_DSC_UTILITY_URL` in the web app.

The utility must:

1. Allow cross-origin requests from the DocSign web origin (`Access-Control-Allow-Origin`).
2. Ask the signer to pick a certificate and enter the token PIN.
3. For each digest, create a **CAdES-detached CMS** (PKCS#7) whose
   `messageDigest` signed attribute equals the digest. It should include the
   `signing-certificate-v2` attribute and the certificate chain.

## Response

```
200 OK
{ "signatures": [ { "documentId": "cm…", "cms": "<base64 DER>" } ] }
```

## What the server checks

`POST /api/v1/signing/:token/dsc/complete` verifies, before embedding anything:

- that each CMS is a valid signature over exactly the bytes prepared for that
  document;
- that the signer certificate is currently valid;
- when `DSC_TRUST_DIR` is set (for example to the CCA India root and licensed
  CA certificates), that the certificate chains to one of those roots.

The audit trail records the certificate subject, issuer, serial number,
validity and whether the chain was verified.
