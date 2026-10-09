# Alpha-Flip Cold Path: Narrative & Cabal Intelligence Daemon

The **Cold Contour** operates asynchronously outside the microsecond execution loop. It aggregates off-chain signals, analyzes on-chain cabal wallet clustering, queries Gemini for narrative momentum classification, and broadcasts structured advisory signals to the Hot Path via Redis.

---

## Non-Negotiable Invariants

1. **Advisory Only**: Cold intelligence has **zero execution authority**. It cannot broadcast Solana transactions, hold private keys, or instruct the hot path to bypass risk limits.
2. **Veto & Downsize Power**: The hot engine listens to the cold advisory channel. If the cold path flags a token as cabal-dump, honeypot, or narrative-exhausted, it can **downgrade size or veto** entry.
3. **No Private Keys**: The cold path has no access to `HOT_WALLET_KEYPAIR_PATH` or wallet key material. It connects purely to read-only APIs and data stores (Redis, Postgres, RPC, Gemini).
4. **Schema Validated**: Every advisory output conforms to strict Pydantic schemas. Malformed signals are discarded by the Hot Engine.

---

## Local Development

```bash
# Setup virtual environment
python3 -m venv venv
source venv/bin/activate

# Install editable with dev dependencies
pip install -e ".[dev]"

# Run tests
pytest tests
```
