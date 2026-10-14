// Server-sent events from a fetch() response (EventSource cannot POST).
// Yields { event, data } with data parsed as JSON.
export async function* readEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const event = block.match(/^event: (.*)$/mu)?.[1] || "message";
      const raw = block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
      if (!raw) continue;
      let data = null;
      try { data = JSON.parse(raw); } catch { data = raw; }
      yield { event, data };
    }
    if (done) break;
  }
}
