import { inspectText } from './inspection.js';
import type { Inspection } from './inspection.js';

export type ScanReply = { result: Inspection } | { error: string };
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<string>) => void) | null;
  postMessage: (reply: ScanReply) => void;
};
scope.onmessage = ({ data }) => {
  try { scope.postMessage({ result: inspectText(data) }); }
  catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : 'Could not inspect this text.' }); }
};
