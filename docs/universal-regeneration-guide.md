# Edgeberry Device Software — Universal Regeneration Guide

Purpose: Provide clear, technology-agnostic guidance for engineers or generative AI to recreate the Edgeberry device software concept in any language and on any platform.

This guide defines the intent, capabilities, constraints, interfaces, behaviors, and validation criteria without prescribing a specific implementation stack.

---

## 1) Problem Statement and Vision

- Create a secure, managed runtime for edge devices that:
  - Connects reliably to a cloud IoT backend using mutual TLS.
  - Publishes device state and consumes commands.
  - Integrates with device hardware (LED, buzzer, button, EEPROM/ID).
  - Exposes a local control plane for on-device applications.
  - Can be installed, updated, monitored, and safely recovered in the field.

- Success is measured by: reliability under poor networks, security of identity, ease of app integration, and operability at scale.

---

## 2) Core Capabilities (Indifferent to Language/OS)

- Secure identity and provisioning
  - Unique device identity; X.509-like certificate model or equivalent.
  - Automated first-boot provisioning on uninitialized devices.

- Cloud connectivity and synchronization
  - Persistent, secure messaging channel (MQTT or equivalent pub/sub RPC).
  - Device state shadow (desired/reported) or equivalent twin model.

- Local control surface
  - Programmatic API available to local processes (DBus/gRPC/local socket/REST).
  - Minimal CLI for admin/diagnostics.

- Hardware integration (if available)
  - Status LED patterns, buzzer feedback, user button events.
  - EEPROM (or alternative) to derive board/UUID information.

- System integration
  - Run as a service/daemon.
  - Configurable via file + environment overrides.
  - Structured logging and metrics.

- Remote operations
  - Reboot, reconnect, update, identify, link-to-user.

---

## 3) Non-Functional Requirements

- Reliability: auto-reconnect, backoff, offline buffering, crash resilience.
- Security: least-privilege, secret at rest protections, validated cloud identity.
- Performance: suitable for low-power edge devices.
- Observability: logs, health endpoints, basic metrics.
- Maintainability: modular boundaries and clear contracts.

---

## 4) Architecture-Agnostic Component Model

Implement these logical modules using idioms of the chosen stack:

- Identity & Provisioning
  - Responsibility: create/obtain device credentials; persist securely; rotate.
  - Inputs: hardware ID/EEPROM; bootstrap config; cloud bootstrap endpoints.
  - Outputs: certs/keys/tokens; stable device identifier.

- Connectivity Client
  - Responsibility: connect, authenticate, maintain session; pub/sub; request/response.
  - Inputs: endpoint, credentials, topics/routes.
  - Outputs: message stream (incoming/outgoing), connection events.

- State Manager (Digital Twin)
  - Responsibility: maintain desired/reported state; resolve drift; persist selectively.
  - Inputs: connectivity messages; local API requests; hardware signals.
  - Outputs: twin updates; signals/events to local clients.

- Command Router (Direct Methods)
  - Responsibility: dispatch cloud-initiated commands to handlers with auth/validation.
  - Inputs: incoming commands (topic/route/RPC).
  - Outputs: structured results, errors, and audit logs.

- Hardware Abstraction
  - Responsibility: optional GPIO/I2C/EEPROM; non-blocking; fault-tolerant.
  - Inputs: state changes and control intents.
  - Outputs: physical signals; device identifiers; button events.

- Local API Surface
  - Responsibility: stable interface for apps (choose one: IPC bus, REST, gRPC, UNIX socket).
  - Inputs: app requests (set info/status, query device state).
  - Outputs: responses; state-changed notifications.

- Configuration & Secrets
  - Responsibility: layered config (defaults → file → env); secure secrets store.

- Service Lifecycle & Observability
  - Responsibility: start/stop; readiness; liveness; logging; metrics.

---

## 5) Minimal Data Contracts (Language-Neutral)

Represent these as JSON, Protobuf, CBOR, or native equivalents, but keep semantics.

- Device Identity
```
DeviceIdentity {
  uuid: string,         // stable identifier
  model?: string,
  firmwareVersion: string
}
```

- Device State (Twin)
```
DeviceState {
  device: { uuid: string, status: "online|offline|provisioning|error", uptimeSeconds: number },
  system?: { cpu: number, memory: number, temperature?: number, network: "connected|disconnected" },
  applications?: [{ name: string, version: string, status: "ok|warning|error|critical", message?: string, lastUpdate?: string }],
  hardware?: { led: "on|off|blinking|fast-blink", buzzer: boolean, buttonPressed?: boolean }
}
```

- Commands
```
Command {
  name: "reboot|update|reconnect|identify|linkToUser",
  id: string,
  params?: object
}

CommandResult {
  id: string,
  status: "success|failed|accepted|in-progress",
  message?: string,
  data?: object
}
```

- Local API Messages
```
SetApplicationInfo { name: string, version: string, description?: string }
SetApplicationStatus { status: "ok|warning|error|critical", message?: string }
GetDeviceStatus -> DeviceState
```

---

## 6) Behavior Specifications (Deterministic, Testable)

- Startup
  - Load config → ensure identity → initialize connectivity → expose local API → enter run loop.
- Connectivity Loss
  - Buffer outbound updates; backoff reconnection; reflect degraded status locally.
- State Sync
  - On desired changes: validate → apply → update reported; emit local events.
  - On local changes: update reported; avoid feedback loops; debounce high-frequency updates.
- Command Handling
  - Validate schema/authorization → execute safely → return structured result; emit audit log.
- Hardware Events
  - Button press mapped to actions (identify/link) with debouncing and timeouts.
- Shutdown
  - Flush queues; close sessions cleanly; persist necessary state.

---

## 7) Security Invariants

- Private keys never leave the device; permissions restrict access.
- All cloud communications are mutually authenticated and encrypted.
- Local API access is restricted by OS primitives (users/groups/ACLs) or service-level auth.
- Configurable allowlist for cloud commands; safe defaults.
- Logs do not include secrets; PII is avoided or minimized.

---

## 8) Operational Contracts

- Configuration precedence: environment > file > defaults.
- Logging: structured, with levels; timestamps; device uuid tag.
- Health: expose readiness/liveness (file socket, HTTP, or supervisor-specific mechanism).
- Upgrades: idempotent installer; atomic updates; rollback strategy defined.
- Observability: basic counters (reconnects, commands handled, error rates).

---

## 9) Extensibility Principles

- New commands: register handler with schema, auth, and timeout.
- New hardware: extend hardware abstraction; do not leak driver specifics upstream.
- New local API methods: versioned; backward compatible; feature-gated.
- Cloud provider swap: isolate connectivity behind an interface; map twin/command concepts.

---

## 10) Portability Guidance (Choose by Platform)

- Linux service managers: systemd, upstart, runit, or container supervisors.
- IPC choices: desktop/server → DBus/gRPC; embedded → UNIX domain socket; cross-device → REST/gRPC.
- Message transport: MQTT preferred; acceptable alternatives: AMQP, NATS, HTTPS long-poll/WebSocket.
- Credential stores: OS keyrings, TPM/TEE, file permissions; choose strongest available.
- Hardware access: abstract via HAL; simulate in environments without GPIO/I2C.

---

## 11) Test Plan (Stack-Agnostic)

- Unit: validate schema transformations, command parsing, state reducers.
- Integration: cloud sandbox with fake twin/command server; reconnect and buffering.
- Hardware-in-the-loop: LED/buzzer/button behavior with simulated faults.
- Soak: long-running connectivity under packet loss and jitter.
- Security: negative tests (invalid certs, expired creds, unauthorized commands).

---

## 12) Acceptance Criteria (Definition of Done)

- Boots unattended and reaches "online" within acceptable time on target class hardware.
- Recovers from network interruptions and power loss without manual intervention.
- Successfully executes remote commands with audit trail.
- Local apps can set info/status and read device state via the chosen local API.
- Installation, upgrade, and uninstall are documented and idempotent.

---

## 13) Deliverables Checklist (For Any Implementation)

- Service/daemon with start/stop/status.
- Config system with env overrides; sample config file.
- Credential generation/provisioning flow; secure storage.
- Connectivity client with reconnection/backoff and telemetry.
- State manager implementing twin semantics.
- Command handlers: reboot, update, reconnect, identify, link-to-user.
- Local API and minimal CLI.
- Logging, health endpoints, and metrics.
- Installer and upgrade scripts or instructions.
- Troubleshooting guide with common failures and remedies.

---

## 14) Migration from This Guide to Code

1) Choose stack (language, runtime, supervisor, IPC, transport).
2) Scaffold modules per the Component Model.
3) Implement Data Contracts; generate types/messages as needed.
4) Wire Behavior Specifications; add retries/backoff.
5) Enforce Security Invariants and Operational Contracts.
6) Write Tests per Test Plan; include fault injection.
7) Produce Deliverables; validate Acceptance Criteria.

This document is intentionally independent of implementation details so it can be used by humans and generative systems to recreate the Edgeberry device software on any platform or in any programming language.
