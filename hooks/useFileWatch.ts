"use client";

import { useEffect, useRef, useState } from "react";
import {
  FileWatchClient,
  type FileWatchSnapshot,
} from "@/lib/file-watch-client";
import type { FileWatchFrame } from "@/lib/file-watch-protocol";

const IDLE_SNAPSHOT: FileWatchSnapshot = Object.freeze({
  connectionState: "idle",
  serverInstanceId: null,
  changeCount: 0,
  exists: null,
  size: null,
  errorClass: null,
});

export function useFileWatch(
  filePath: string,
  sourceSessionId: string | null | undefined,
  onFrame: (frame: FileWatchFrame) => void,
): FileWatchSnapshot {
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const [snapshot, setSnapshot] = useState<FileWatchSnapshot>(IDLE_SNAPSHOT);

  useEffect(() => {
    const client = new FileWatchClient(filePath, sourceSessionId ?? null);
    const unsubscribeSnapshot = client.subscribe(setSnapshot);
    const unsubscribeFrames = client.subscribeFrames((frame) => onFrameRef.current(frame));
    client.start();
    return () => {
      unsubscribeFrames();
      unsubscribeSnapshot();
      client.stop();
    };
  }, [filePath, sourceSessionId]);

  return snapshot;
}
