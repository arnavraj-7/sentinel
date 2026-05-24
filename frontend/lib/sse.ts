// Hand-rolled SSE client over fetch — native EventSource only supports GET,
// but we want POST (with a JSON body for /incidents/stream + /approve/stream).
// ~40 lines, no extra lib. Parses event/data line-pairs per the SSE spec.

export type SSEEvent = { event: string; data: string };

export async function* sseStream(
  url: string,
  init: RequestInit & { signal?: AbortSignal },
): AsyncGenerator<SSEEvent, void, void> {
  const resp = await fetch(url, {
    ...init,
    headers: { Accept: "text/event-stream", ...(init.headers ?? {}) },
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`SSE: HTTP ${resp.status} ${resp.statusText}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line ('\n\n' or '\r\n\r\n').
      // Normalise CRLF first then split on the empty line.
      buffer = buffer.replace(/\r\n/g, "\n");
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const evt = parseBlock(block);
        if (evt) yield evt;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseBlock(block: string): SSEEvent | null {
  let event = "message";
  const dataParts: string[] = [];
  for (const rawLine of block.split("\n")) {
    if (rawLine.startsWith(":")) continue; // SSE comment
    if (rawLine.startsWith("event:")) {
      event = rawLine.slice(6).trim();
    } else if (rawLine.startsWith("data:")) {
      // The SSE spec strips ONE leading space if present (data: hi → "hi")
      dataParts.push(
        rawLine[5] === " " ? rawLine.slice(6) : rawLine.slice(5),
      );
    }
  }
  if (event === "message" && dataParts.length === 0) return null;
  return { event, data: dataParts.join("\n") };
}
