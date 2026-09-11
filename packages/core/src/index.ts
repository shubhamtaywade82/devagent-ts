/**
 * @nemesis-oss/nexum-core — the agent execution kernel plane.
 *
 * Zero-dependency: contracts, tool gateway, policy engine, model gateway
 * port, strategies, gates, events, budgets, runtime primitives, platform
 * and safety vocabulary. Model/tool implementations live in the sibling
 * packages; deep imports (e.g. @nemesis-oss/nexum-core/runtime/events)
 * are supported via the package exports map.
 */
export * from "./kernel/index.js";
