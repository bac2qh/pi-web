import path from "node:path";
import {
  getAllowedFileRoots,
  isFilePathAllowed,
  isWindowsAbsolutePath,
  normalizeSlashes,
} from "./file-access";
import { isFilePathReferencedBySession } from "./session-file-references";

export type FileAuthorizationOutcome = "allowed_root" | "allowed_session_reference" | "denied";

export type FileAuthorizationDependencies = Readonly<{
  getAllowedRoots(): Promise<Set<string>>;
  isAllowed(filePath: string, roots: Set<string>): boolean;
  isReferenced(filePath: string, sessionId: string | null): Promise<boolean>;
}>;

const defaultDependencies: FileAuthorizationDependencies = {
  getAllowedRoots: getAllowedFileRoots,
  isAllowed: isFilePathAllowed,
  isReferenced: isFilePathReferencedBySession,
};

/** The exact read authorization decision shared by the file GET and watch ticket routes. */
export async function authorizeFileRequest(
  filePath: string,
  sessionId: string | null,
  allowSessionReference: boolean,
  dependencies: FileAuthorizationDependencies = defaultDependencies,
): Promise<FileAuthorizationOutcome> {
  const roots = await dependencies.getAllowedRoots();
  if (dependencies.isAllowed(filePath, roots)) return "allowed_root";
  if (allowSessionReference && await dependencies.isReferenced(filePath, sessionId)) {
    return "allowed_session_reference";
  }
  return "denied";
}

export function isAbsoluteFilePath(filePath: string): boolean {
  return path.isAbsolute(filePath) || isWindowsAbsolutePath(filePath);
}

/** Normalize with the same host/Windows distinction used by lexical file authorization. */
export function normalizeAbsoluteFilePath(filePath: string): string | null {
  if (!isAbsoluteFilePath(filePath)) return null;
  if (isWindowsAbsolutePath(filePath)) return normalizeSlashes(path.win32.resolve(filePath));
  return path.resolve(filePath);
}
