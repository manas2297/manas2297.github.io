---
title: "lockIt: High-Throughput Low-Latency Encrypted Storage"
date: 2026-08-02
category: "Security Architecture"
tag: "Low-latency Centralized Storage"
image: "img/lockit_storage.jpg"
role: "Security Architect"
scale: "300M+ Calls Daily"
impact: "Scaled 0 to 300M+ Requests (80% GETs)"
description: "Designed a centralized storage mechanism to hold encrypted user-sensitive data. Handled 300M+ calls daily with sub-millisecond latency, optimized for 80% read-heavy traffic patterns."
---

## The Context

In modern scale architectures, handling user-sensitive details (like PII, credit card details, and personal tokens) requires absolute security compliance without becoming a processing bottleneck. I designed and built **lockIt**—a low-latency centralized storage mechanism for storing and recovering encrypted sensitive data on-the-fly.

This service started from scratch and scaled to support **300 million daily API requests**, serving as the secure key-value and PII resolution engine for the organization's entire microservice topology.

---

## The Challenge

Developing a system that encrypts every entry while sustaining high throughput introduces major scaling obstacles:

*   **Sub-Millisecond Read Latency**: The application stack relies on this service for user lookups. With an **80% GET traffic ratio** (240 million read requests daily), read operations had to execute virtually instantaneously.
*   **Cryptographic Overhead**: Encrypting and decrypting data dynamically using enterprise AES-256 blocks with custom Key Management Service (KMS) handshakes can heavily spike CPU cores.
*   **Zero-Loss Integrity**: If a key or encrypted block is misplaced, user profiles become corrupted. The storage backend required absolute durability guarantees.

---

## The Architecture & Execution

To handle this load, I designed the service around a decoupled, read-optimized topology:

*   **Distributed Read-Through Caching**: Implemented a multi-tier memory caching structure using Redis Sentinel and in-memory caches. This routed 80% of lookups directly to optimized RAM channels, reducing database read hops to zero for active user flows.
*   **AES-256 GCM Concurrency Pipeline**: Wrote optimized cryptographic worker pools in Go. This allowed lockIt to batch encryption blocks, utilizing CPU vector registers (using Intel AVX512/ARM Neon assembly instructions where available) to perform encryptions concurrently without blocking network loops.
*   **Decoupled Write Buffering**: While reads are immediate, write operations are processed via an event buffer. If the primary storage backend experiences traffic spikes, incoming writes are safely queued and written sequentially, preserving write availability.

---

## The Results

The architecture successfully scaled from zero to standard production scale:

*   **300M Daily Requests**: Safely manages over 300 million calls daily with absolute uptime.
*   **Low Latency**: Achieved sub-5ms average lookup times under peak load (under 1ms for cached lookups).
*   **Open Source Offering**: Due to its success, I am working on polishing this codebase to release it as a free, open-source centralized storage engine that any engineering team can self-host.
