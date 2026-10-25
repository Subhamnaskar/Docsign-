# Deployment notes

## Cells

Each regional cell is one copy of the stack (API, worker, web, Postgres, S3-compatible storage, SMTP relay, ClamAV, Gotenberg) with its own data. Set `CELL_REGION` to the cell's name. Data never moves between cells.

A **dedicated cell** for a large customer is the same deployment with one organisation in it. Use separate cloud accounts or projects, a dedicated KMS key for the seal (`SEAL_KEY_PROVIDER=aws-kms`) and, if the customer wants it, their own storage key (Settings → Governance → Customer-managed encryption key).

Run more than one API replica with `WORKER_MODE=off` and exactly one `npm run worker`.

## Seal key in AWS KMS

1. Create an asymmetric KMS key: key spec `RSA_3072`, usage `SIGN_VERIFY`.
2. Download its public key, create a CSR for it (for example with `aws-kms-pkcs11` or a CA's KMS integration) and get a document-signing certificate from an AATL-listed CA so Adobe Reader shows a green tick.
3. Save the certificate chain (seal certificate first, then intermediates) as a PEM file on the API hosts.
4. Configure:

```
SEAL_KEY_PROVIDER=aws-kms
SEAL_KMS_KEY_ID=arn:aws:kms:ap-south-1:123456789012:key/…
SEAL_KMS_REGION=ap-south-1
SEAL_CERT_CHAIN_PATH=/etc/docsign/seal-chain.pem
```

The API needs `kms:Sign` on the key. Only SHA-256 digests are sent to KMS.

## Customer-managed storage keys

When an organisation sets a KMS key ARN under Settings → Governance, new files for its agreements are written with SSE-KMS under that key. The storage service must support SSE-KMS (Amazon S3 does; the local RustFS container does not). The customer grants the platform's IAM role `kms:GenerateDataKey` and `kms:Decrypt`.

## Custom signing domains

Organisations can send signing links on their own domain (Settings → Governance → Signing domain). They add a CNAME to this service and a TXT record for verification. TLS certificates for those domains are issued on demand by the reverse proxy; only verified domains are allowed. With Caddy:

```
{
  on_demand_tls {
    ask http://api:4000/api/v1/domains/check
  }
}

https:// {
  tls {
    on_demand
  }
  reverse_proxy web:3000
}
```

## Email from customers' domains

Each organisation can verify a sending domain (Settings → Governance → Email sender). The platform generates a DKIM key per domain and signs outgoing mail with it. The SMTP relay must allow the customer's `From` domain (for Amazon SES, verify the domain in SES too, or use a relay that permits any domain). The customer also adds the relay to their SPF record.

## Retention and deletion

The worker deletes agreements according to each organisation's retention settings, never before the jurisdiction's legal retention period and never while on legal hold. Objects written with S3 Object Lock cannot be deleted until their retention date; the worker retries until then. Use `COMPLIANCE` mode Object Lock in production cells (`apps/api/src/lib/storage.ts`).
