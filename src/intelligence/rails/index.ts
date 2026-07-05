/** Rails Semantic Index — public API. */

export * from "./types";
export { discoverWorkspace } from "./workspace-discovery";
export { buildManifest, manifestHash } from "./manifest";
export { KnowledgeGraph } from "./graph/graph";
export type { TraverseOptions, TraversalNode, GraphStats } from "./graph/graph";
export { SemanticIndex } from "./indexer";
export { GraphStore } from "./graph/graph-store";
export { QueryEngine } from "./query-engine";
export type { DependencyTrace } from "./query-engine";
export { RailsContextBuilder, extractCandidates } from "./context-builder";
export type { RailsContext } from "./context-builder";
export { createRailsTools } from "./tools/semantic-tools";
