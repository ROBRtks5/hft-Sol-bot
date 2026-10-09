# Alpha-Flip v3.2 Production Security Checklist

Prior to activating **SHADOW** or **LIVE** trading modes, the following technical and operational security controls MUST be audited and signed off.

---

## 1. Secrets & Private Key Protections
- [ ] **No Keypairs in Source Code**: Zero hardcoded private keys, seed phrases, or keypair JSON files in git repository.
- [ ] **Environment Variable Hygiene**: Secrets passed strictly via secure systemd `EnvironmentFile` (mode `0600`, owned by `alphaflip:alphaflip`) or Secret Manager (Vault / AWS Secrets Manager).
- [ ] **Zero Core-Dump Leaks**: `PR_SET_DUMPABLE` disabled, core dumps restricted via systemd / sysctl (`fs.suid_dumpable = 0`).
- [ ] **Log Scrubbing Validated**: Structured logging layer (`logging.rs`) automatically replaces any byte array, seed, or secret phrase with `[REDACTED_SECRET]`.
- [ ] **Dedicated Execution Wallet**: Never trade from a primary treasury or personal wallet. Use dedicated hot wallet funded with exact risk allocation.

---

## 2. Network & Boundary Protections
- [ ] **gRPC TLS Enforced**: Yellowstone gRPC connection uses TLS with pinned root certificates.
- [ ] **Jito Block Engine Authentication**: Jito auth keys kept in runtime memory only, not logged.
- [ ] **Metrics Isolation**: Prometheus metrics port (`9090`) bound to loopback or private VPC network only; never exposed directly to public internet without mTLS or reverse proxy auth.
- [ ] **Redis Isolation**: Cold path Redis instance requires strong auth token and runs over TLS/Unix socket.

---

## 3. Host & Runtime Hardening
- [ ] **Non-Root Execution**: Hot path daemon executes under dedicated unprivileged UID `10001` (`alphaflip`).
- [ ] **Read-Only Root Filesystem**: `ProtectSystem=strict` and read-only container root enforced; only `/var/lib/alpha-flip` is writable for journal.
- [ ] **No New Privileges**: `NoNewPrivileges=true` enabled in systemd and Docker definitions.
- [ ] **Capability Dropping**: All Linux kernel capabilities dropped (`CapabilityBoundingSet=`).
- [ ] **Memory Protections**: `MemoryDenyWriteExecute=true` enabled to block dynamic code injection.

---

## 4. Invariant & Risk Gates Hardening
- [ ] **One Open Position Constraint**: Hot path state machine guarantees maximum 1 open position at any moment (`MAX_CONCURRENT_POSITIONS = 1`).
- [ ] **Capital Floor Guard**: Bot aborts execution if wallet balance falls below `wallet_balance_floor_sol`.
- [ ] **Daily Drawdown Circuit Breaker**: Hard loss cap enforces permanent trading pause for the session upon breach.
- [ ] **AI Boundary Strictness**: Cold path (Gemini) advisory cannot trigger buys, increase position size beyond hard max, or override liquidity caps.
