/**
 * FilesystemPack (review item 21) — workspace file operations.
 *
 * read/write/list/copy/move/delete/watch + the CAS editing primitives
 * (apply_patch primary, edit_file_lines convenience, find/replace legacy)
 * + workspace code search.
 */

import { ReadFileTool, WriteFileTool } from "../filesystem.js";
import {
  ListDirectoryTool,
  DeleteFileTool,
  MakeDirectoryTool,
  CopyFileTool,
  MoveFileTool,
} from "../directory-tools.js";
import { PatchTool, AppendTool, ApplyPatchTool, EditFileLinesTool } from "../edit-tools.js";
import { CasEditor } from "../mutations/cas-editor.js";
import { WorkspaceGuard } from "../../core/fs/workspace-guard.js";
import { SnapshotBackupTool } from "../backup-tools.js";
import { WatchTool } from "../watch-tool.js";
import { SearchCodeTool } from "../search-tools.js";
import { ToolPack, packOf } from "../gateway/tool-pack.js";

/** Filesystem CRUD + CAS patch + watch — the DevAgent's core mutation surface. */
export function filesystemPack(root: string): ToolPack {
  // CAS editor over the centralized workspace guard (review items 9, 10, 11):
  // apply_patch is the primary editing primitive; edit_file_lines is the
  // line-based convenience; find/replace (patch_file) stays as a wrapper.
  const guard = new WorkspaceGuard({ root });
  const editor = new CasEditor({ guard });
  return packOf(
    "filesystem",
    "Workspace file operations: read, write, list, copy, move, delete, patch (CAS), watch.",
    "filesystem",
    [
      new ReadFileTool(root),
      new WriteFileTool(root),
      new ListDirectoryTool(root),
      new DeleteFileTool(root),
      new MakeDirectoryTool(root),
      new CopyFileTool(root),
      new MoveFileTool(root),
      [new ApplyPatchTool(editor), { risk: "medium", execution: { reversible: true } }],
      [new EditFileLinesTool(editor), { risk: "medium", execution: { reversible: true } }],
      new PatchTool(root),
      new AppendTool(root),
      new SnapshotBackupTool(root),
      new WatchTool(root),
    ],
    "Filesystem",
  );
}

/** Workspace code search (kept inside the FilesystemPack family). */
export function searchPack(root: string): ToolPack {
  return packOf("search", "Workspace code search.", "search", [new SearchCodeTool(root)], "Search");
}
