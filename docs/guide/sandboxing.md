# Docker Sandboxing

Executing untrusted AI-generated scripts directly on your host machine introduces serious security and data-loss risks.

---

## Security Guarantees

DevAgent-TS runs every `shell` command inside an isolated container with:

1. **No Network Access (`--network=none`)**: Blocks data exfiltration and external malware downloads.
2. **Resource Bounds**: Caps memory (2 GB) and CPU cores to avoid resource starvation.
3. **Output Ceiling & Process Escalation**: If command stdout/stderr exceeds 2 MiB, a `SIGKILL` is issued immediately.
4. **Volume Mounting**: Only the target workspace directory is mounted into the container.
